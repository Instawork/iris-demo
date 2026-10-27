"use client"

import { AlertTriangle, CheckCircle2, FileText, Loader2, ScanText, ShieldCheck, Upload } from "lucide-react"
import { useState } from "react"

import { Field, inputClass } from "@/components/onboarding/steps"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useWorkspace } from "@/hooks/use-app"
import { formatDateFull, todayISO } from "@/lib/dates"
import { fullName } from "@/lib/format"
import { requirementLabel, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { Pro, RequirementId } from "@/lib/types"
import { CHECKS, expiryFor, readDocument } from "@/lib/verification"

/**
 * Renewing a document the way Compass needs it done: the agency attaches it, Iris reads it, the agency attests it,
 * and Iris checks it with whoever issued it before the Pro is cleared. Anything Iris can't confirm waits for Compass.
 */

type Phase = "form" | "reading" | "checking" | "verified" | "held"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function VerifyDialog({ pro, requirement, onOpenChange }: { pro: Pro; requirement: RequirementId; onOpenChange: (open: boolean) => void }) {
  const { ws } = useWorkspace()
  const verifyRequirement = useStore((s) => s.verifyRequirement)
  const check = CHECKS[requirement]
  const label = requirementLabel(requirement)
  const today = todayISO()
  const [phase, setPhase] = useState<Phase>("form")
  const [file, setFile] = useState("")
  const [provider, setProvider] = useState(check.providers[0])
  const [reference, setReference] = useState("")
  const [issuedOn, setIssuedOn] = useState(today)
  const [expiresOn, setExpiresOn] = useState(expiryFor(requirement, today) ?? "")
  const [attested, setAttested] = useState(false)
  const [reason, setReason] = useState("")
  const [verb] = useState(pro.compliance[requirement]?.status === "complete" ? "Renew" : "Add")
  const who = ws.kind === "supplier" ? `${ws.user.name}, ${supplier(pro.supplierId).shortName}` : ws.user.name

  const attach = async (name: string) => {
    if (!name) return
    setFile(name)
    setPhase("reading")
    await sleep(900)
    const read = readDocument(requirement, pro.id, today)
    setProvider(read.provider)
    setReference(read.reference)
    setIssuedOn(read.issuedOn)
    setExpiresOn(read.expiresOn ?? "")
    setPhase("form")
  }

  const submit = async () => {
    setPhase("checking")
    const [answer] = await Promise.all([
      verifyRequirement(pro.id, requirement, { provider, reference, issuedOn, expiresOn: check.validYears ? expiresOn : undefined, file: file || undefined }),
      sleep(1400),
    ])
    if (!answer) return setPhase("form")
    if (answer.result === "verified") {
      setPhase("verified")
      await sleep(1600)
      onOpenChange(false)
      return
    }
    setReason(answer.reason ?? "")
    setPhase("held")
  }

  const ready = !!reference.trim() && !!issuedOn && (!check.validYears || !!expiresOn) && attested

  return (
    <Dialog open onOpenChange={(open) => phase !== "checking" && onOpenChange(open)}>
      <DialogContent className="sm:max-w-lg" data-tour="verify-dialog" data-doc-id={requirement}>
        <DialogHeader>
          <DialogTitle>
            {verb} {pro.firstName}&apos;s {label.toLowerCase()}
          </DialogTitle>
          <DialogDescription>Attach the document. Iris reads it, you attest it, and Iris checks it with {check.providers.length > 1 ? "whoever issued it" : check.providers[0]} before clearing {pro.firstName}.</DialogDescription>
        </DialogHeader>

        {phase === "verified" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-positive" />
            <p className="text-featured-3 font-semibold">Verified with {provider}</p>
            <p className="text-body-3 text-faded">
              {check.reference.label} {reference.trim()}
              {check.validYears && expiresOn ? ` · valid to ${formatDateFull(expiresOn)}` : ""}. Attested by {who}.
            </p>
          </div>
        ) : phase === "held" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl border border-warning-border bg-warning-faded p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="flex flex-col gap-1 text-body-3">
                <span className="font-semibold">Iris couldn&apos;t verify it: {reason}.</span>
                <span>It&apos;s waiting on Compass compliance, and {pro.firstName} stays off shifts until it&apos;s confirmed.</span>
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => setPhase("form")}>Fix it and try again</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border-strong p-4 hover:bg-hover">
              {phase === "reading" ? <ScanText className="size-5 animate-pulse" /> : file ? <FileText className="size-5" /> : <Upload className="size-5 text-faded" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-3 font-semibold">{phase === "reading" ? `Reading ${file}…` : file || `Attach the ${label.toLowerCase()}`}</span>
                <span className="text-caption-1 text-faded">{file && phase !== "reading" ? "Iris filled in what it read. Check it against the document." : "PDF or a photo. Iris reads the issuer, number and dates off it."}</span>
              </span>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.heic" className="sr-only" onChange={(e) => attach(e.target.files?.[0]?.name ?? "")} />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Issued by">
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {check.providers.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={check.reference.label}>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={check.reference.placeholder} className={inputClass} data-tour="verify-reference" />
              </Field>
              <Field label={check.issuedLabel}>
                <input type="date" value={issuedOn} max={today} onChange={(e) => (setIssuedOn(e.target.value), check.validYears && setExpiresOn(expiryFor(requirement, e.target.value) ?? ""))} className={inputClass} />
              </Field>
              {check.validYears ? (
                <Field label="Expires on">
                  <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={inputClass} />
                </Field>
              ) : (
                <Field label="Expires">
                  <span className="flex h-9 items-center text-body-3 text-faded">Doesn&apos;t expire</span>
                </Field>
              )}
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-border p-4">
              <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5" />
              <span className="text-body-3">
                I attest this {label.toLowerCase()} is genuine, current, and belongs to <span className="font-semibold">{fullName(pro)}</span>.
                <span className="block text-caption-1 text-faded">Recorded as {who}.</span>
              </span>
            </label>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={phase === "checking"}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!ready || phase !== "form"} data-tour="verify-submit">
                {phase === "checking" ? (
                  <>
                    <Loader2 className="animate-spin" /> Checking with {provider}…
                  </>
                ) : (
                  <>
                    <ShieldCheck /> Verify and clear
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

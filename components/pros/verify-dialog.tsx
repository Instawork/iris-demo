"use client"

import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWorkspace } from "@/hooks/use-app"
import { formatDateFull, todayISO } from "@/lib/dates"
import { fullName } from "@/lib/format"
import { requirementLabel, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { Pro, RequirementId } from "@/lib/types"
import { CHECKS, readDocument } from "@/lib/verification"

/**
 * Clearing a document. Training and certifications are one click: Sterling, ServSafe or Compass Learning already has
 * the current one, so Iris asks them. Work authorization has no issuer to ask, so the agency attests it as the employer.
 */

type Phase = "form" | "checking" | "verified" | "held"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function VerifyDialog({ pro, requirement, onOpenChange }: { pro: Pro; requirement: RequirementId; onOpenChange: (open: boolean) => void }) {
  const { ws } = useWorkspace()
  const verifyRequirement = useStore((s) => s.verifyRequirement)
  const check = CHECKS[requirement]
  const asked = !check.attested
  const label = requirementLabel(requirement)
  const today = todayISO()
  const found = readDocument(requirement, pro.id, today)
  const [lead] = useState(() => {
    const onFile = pro.compliance[requirement]
    return onFile?.expiresOn && onFile.expiresOn <= today
      ? `${pro.firstName}'s ${label.toLowerCase()} expired ${formatDateFull(onFile.expiresOn)}.`
      : `${pro.firstName} has no current ${label.toLowerCase()} on file.`
  })
  const [phase, setPhase] = useState<Phase>("form")
  const [attested, setAttested] = useState(false)
  const [reason, setReason] = useState("")
  const agency = supplier(pro.supplierId).shortName
  const who = ws.kind === "supplier" ? `${ws.user.name}, ${agency}` : ws.user.name

  const submit = async () => {
    setPhase("checking")
    const [answer] = await Promise.all([
      verifyRequirement(pro.id, requirement, { provider: found.provider, reference: found.reference, issuedOn: found.issuedOn, expiresOn: found.expiresOn }),
      sleep(asked ? 1400 : 700),
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

  return (
    <Dialog open onOpenChange={(open) => phase !== "checking" && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md" data-tour="verify-dialog" data-doc-id={requirement} data-provider={asked ? found.provider : undefined}>
        {phase === "verified" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-positive" />
            <p className="text-featured-3 font-semibold">{asked ? `Verified with ${found.provider}` : "Attested"}</p>
            <p className="text-body-3 text-faded">
              {asked
                ? `${check.reference.label} ${found.reference}${found.expiresOn ? ` · good through ${formatDateFull(found.expiresOn)}` : ""}.`
                : `Recorded as ${who}, ${formatDateFull(today)}.`}
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
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{asked ? `Ask ${found.provider}` : `Attest ${pro.firstName}'s work authorization`}</DialogTitle>
              <DialogDescription>
                {lead} {asked ? `${found.provider} has the current one.` : `${agency} redoes the I-9 as the employer. Iris records who attested it.`}
              </DialogDescription>
            </DialogHeader>
            {!asked && (
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5" />
                <span className="text-body-3">
                  I attest <span className="font-semibold">{fullName(pro)}</span> completed a current Form I-9 with {agency} and is authorized to work in the US.
                  <span className="block text-caption-1 text-faded">Recorded as {who}.</span>
                </span>
              </label>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={phase === "checking"}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={phase !== "form" || (!asked && !attested)} data-tour="verify-submit">
                {phase === "checking" ? (
                  <>
                    <Loader2 className="animate-spin" /> {asked ? `Asking ${found.provider}…` : "Recording…"}
                  </>
                ) : asked ? (
                  <>Ask {found.provider}</>
                ) : (
                  <>
                    <ShieldCheck /> Attest
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

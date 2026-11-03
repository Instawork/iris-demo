"use client"

import { Check, FileText, Loader2, Upload, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { CERT_TITLE } from "@/lib/certificate"
import { formatDateFull, todayISO } from "@/lib/dates"
import { useStore } from "@/lib/store"
import type { Pro, RequirementId } from "@/lib/types"
import { cn } from "@/lib/utils"
import { readDocument } from "@/lib/verification"

type Phase = "pick" | "reading" | "verifying" | "done" | "held"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The agency uploads the worker's card, Iris reads it, then checks it with the issuer. The row turns green when the
 * issuer confirms it; anything the issuer can't match waits on Compass compliance.
 */
export function CertUpload({ pro, requirement, onClose }: { pro: Pro; requirement: RequirementId; onClose: () => void }) {
  const verifyRequirement = useStore((s) => s.verifyRequirement)
  const input = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>("pick")
  const [file, setFile] = useState<File>()
  const [preview, setPreview] = useState<string>()
  const [reason, setReason] = useState<string>()
  const [over, setOver] = useState(false)
  const found = readDocument(requirement, pro.id, todayISO())

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const take = async (next?: File) => {
    if (!next || phase !== "pick") return
    setFile(next)
    if (next.type.startsWith("image/")) setPreview(URL.createObjectURL(next))
    setPhase("reading")
    await wait(1000)
    setPhase("verifying")
    const [answer] = await Promise.all([
      verifyRequirement(pro.id, requirement, { provider: found.provider, reference: found.reference, issuedOn: found.issuedOn, expiresOn: found.expiresOn, file: next.name }),
      wait(1100),
    ])
    if (!answer) return setPhase("pick")
    if (answer.result !== "verified") {
      setReason(answer.reason)
      return setPhase("held")
    }
    setPhase("done")
    await wait(1400)
    onClose()
  }

  const read = phase === "verifying" || phase === "done" || phase === "held"
  return (
    <div className="ml-7 flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3" data-tour="cert-upload">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption-1 font-semibold">Upload {pro.firstName}&apos;s {(CERT_TITLE[requirement] ?? "certificate").toLowerCase()}</span>
        {phase === "pick" && (
          <button type="button" className="rounded p-0.5 text-faded hover:text-foreground" onClick={onClose} aria-label="Cancel upload">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {phase === "pick" ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            void take(e.dataTransfer.files[0])
          }}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-4 py-5 text-center transition-colors hover:border-foreground/30",
            over && "border-foreground/40 bg-muted",
          )}
          data-tour="cert-dropzone"
        >
          <Upload className="size-5 text-faded" />
          <span className="text-body-3 font-medium">Drop a photo or PDF of the card</span>
          <span className="text-caption-1 text-faded">Or click to choose a file</span>
        </button>
      ) : (
        <div className="flex gap-3">
          <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={file?.name ?? "Uploaded certificate"} className="size-full object-contain" />
            ) : (
              <FileText className="size-6 text-faded" />
            )}
          </div>
          <ol className="flex min-w-0 flex-1 flex-col gap-1.5 text-caption-1">
            <Line state="done">Uploaded {file?.name}</Line>
            <Line state={phase === "reading" ? "busy" : "done"}>
              {read ? (
                <>
                  Iris read it: certificate {found.reference}
                  {found.expiresOn ? `, valid to ${formatDateFull(found.expiresOn)}` : ""}
                </>
              ) : (
                "Iris is reading the card"
              )}
            </Line>
            {read && (
              <Line state={phase === "verifying" ? "busy" : phase === "held" ? "held" : "done"}>
                {phase === "verifying" ? "Checking it with the issuer" : phase === "held" ? `Waiting on Compass compliance: ${reason ?? "the issuer had no match"}` : "Verified with the issuer"}
              </Line>
            )}
          </ol>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        data-cert-file={requirement}
        onChange={(e) => {
          void take(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      {phase === "held" && (
        <button type="button" className="self-end text-caption-1 font-medium text-faded hover:text-foreground" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  )
}

function Line({ state, children }: { state: "busy" | "done" | "held"; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-start gap-1.5", state === "held" && "text-warning-fg")}>
      {state === "busy" ? (
        <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-faded" />
      ) : state === "done" ? (
        <Check className="mt-0.5 size-3 shrink-0 text-positive-fg" />
      ) : (
        <X className="mt-0.5 size-3 shrink-0" />
      )}
      <span className="min-w-0 break-words">{children}</span>
    </li>
  )
}

"use client"

import { Check, ReceiptText, Undo2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatDateShort, formatTimestamp } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { billingFindings, canCredit, creditDue } from "@/lib/metrics"
import { supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { Invoice } from "@/lib/types"

type Decision = "send_back" | "accept"

/**
 * Hours a unit approved as billed even though Iris's clock showed fewer. Compass sends them back to the agency for a
 * credit or accepts them; the agency answers with the credit, which comes off this invoice.
 */
export function BillingReview({ invoice }: { invoice: Invoice }) {
  const data = useData()
  const { ws } = useWorkspace()
  const { decideBilling, creditInvoice } = useStore.getState()
  const [decision, setDecision] = useState<Decision>()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const findings = billingFindings(data, invoice.id)
  const review = invoice.billingReview
  if (!findings.length && !review) return null

  const sup = supplier(invoice.supplierId).shortName
  const isCompass = ws.kind === "compass"
  const isAgency = ws.kind === "supplier" && ws.supplierId === invoice.supplierId
  const due = creditDue(data, invoice)
  const credits = invoice.credits ?? []
  const credited = review?.status === "credited"

  const start = (next: Decision) => {
    setNote("")
    setDecision(next)
  }

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const confirm = () =>
    run(async () => {
      if (!decision) return
      if (!(await decideBilling(invoice.id, decision, note.trim() || undefined))) return
      if (decision === "send_back") toast(`${invoice.number} sent back to ${sup}`, { description: `${sup} is asked to credit ${money(due)}. The credit comes off this invoice.` })
      else toast.success(`Accepted the hours on ${invoice.number} as billed`)
    })

  const credit = () =>
    run(async () => {
      const amount = await creditInvoice(invoice.id)
      if (amount !== undefined) toast.success(`Credited ${money(amount)} on ${invoice.number}`, { description: "Compass can pay the invoice now." })
    })

  const title = credited ? `${sup} credited ${money(review!.amount)}` : review?.status === "accepted" ? "Accepted as billed" : "Hours billed above Iris's clock"
  const description = credited
    ? `For hours billed above Iris's clock, after ${review!.by} sent ${plural(review!.lineIds.length, "line")} back. ${review!.lineIds.length === 1 ? "The timesheet now matches" : "The timesheets now match"} the clock.`
    : review?.status === "sent_back"
      ? `${review.by} sent ${plural(review.lineIds.length, "line")} back on ${formatTimestamp(review.at)}. ${isAgency ? "Credit it so the invoice can be paid." : `Waiting on ${sup} to credit ${money(review.amount)}.`}`
      : review?.status === "accepted"
        ? `${review.by} accepted ${plural(review.lineIds.length, "line")} as billed on ${formatTimestamp(review.at)}.`
        : `The unit approved ${findings.length === 1 ? "this line" : "these lines"} as billed, but Iris's clock shows fewer hours. ${money(due)} is billed above it.`

  const actions =
    isCompass && !review && canCredit(invoice) ? (
      <>
        <Button variant="outline" className="h-8 gap-1.5 rounded-lg text-body-3" onClick={() => start("accept")}>
          <Check className="size-4" /> Accept as billed
        </Button>
        <Button className="h-8 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => start("send_back")} data-tour="send-back">
          <Undo2 className="size-4" /> Send back for a credit
        </Button>
      </>
    ) : isAgency && review?.status === "sent_back" ? (
      <Button className="h-8 gap-1.5 rounded-lg text-body-3 font-semibold" disabled={busy} onClick={credit}>
        <ReceiptText className="size-4" /> Credit {money(review.amount)}
      </Button>
    ) : review ? (
      <StatusBadge tone={credited ? "positive" : review.status === "sent_back" ? "warning" : "neutral"}>
        {credited ? "Credited" : review.status === "sent_back" ? `Waiting on ${sup}` : "Accepted"}
      </StatusBadge>
    ) : undefined

  const rows = credited
    ? credits.filter((c) => review!.lineIds.includes(c.lineId)).map((c) => ({ id: c.id, who: c.proName, date: c.date, what: c.reason, why: undefined as string | undefined, hours: c.hours, amount: c.amount }))
    : findings.map((f) => ({ id: f.lineId, who: f.proName, date: f.date, what: `${f.label}. ${f.detail}`, why: `Approved as billed by ${f.approvedBy}: “${f.reason}”`, hours: f.hours, amount: f.amount }))

  return (
    <Surface elevated data-tour="billing-review">
      <SurfaceHeader title={title} description={description} actions={actions} />
      <ul className="flex flex-col px-5 pt-1 pb-4">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-4 border-t border-border/80 py-3 first:border-t-0">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-body-3">
              <span className="font-semibold">
                {r.who} · {formatDateShort(r.date)}
              </span>
              <span className="text-faded">{r.what}</span>
              {r.why && <span className="text-caption-1 text-faded">{r.why}</span>}
            </span>
            <span className="flex shrink-0 flex-col items-end text-body-3 tabular">
              <span className="font-semibold text-critical-fg">−{money(r.amount)}</span>
              <span className="text-caption-1 text-faded">{r.hours.toFixed(2)} hrs</span>
            </span>
          </li>
        ))}
      </ul>
      {review?.note && <p className="mx-5 mb-5 rounded-lg bg-tint-faded px-3 py-2 text-body-3 text-faded">Note from {review.by}: “{review.note}”</p>}

      <AlertDialog open={!!decision} onOpenChange={(o) => !o && setDecision(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decision === "send_back" ? `Send ${invoice.number} back to ${sup}?` : `Accept these hours on ${invoice.number} as billed?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision === "send_back"
                ? `${sup} is asked to credit ${money(due)} for ${plural(findings.length, "line")} billed above Iris's clock. The credit comes off this invoice, and the timesheets are revised to the clock.`
                : `The ${plural(findings.length, "line")} stay as billed and the invoice is cleared for payment.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the agency (optional)" className="min-h-20 rounded-lg text-body-3" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={confirm}>
              {decision === "send_back" ? "Send back" : "Accept as billed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Surface>
  )
}

"use client"

import { ShieldCheck, TrendingDown } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { InfoTip } from "@/components/common/info-tip"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { formatDelta } from "@/components/invoices/invoice-bits"
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
import { useData } from "@/hooks/use-app"
import { formatDateShort } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { ANOMALY_THRESHOLD, invoiceBenchmark } from "@/lib/metrics"
import { buyer, city, location, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { DemoData, Invoice, InvoiceLine } from "@/lib/types"
import { cn } from "@/lib/utils"

type Decision = "reviewed" | "rate_review"

/** A peer only quotes the hours it has an active rate for, so its amount is compared with this invoice's labor on those same lines. */
const hasRate = (data: DemoData, supplierId: string, line: InvoiceLine) => {
  const cityId = location(line.locationId).cityId
  return data.rateCards.some((c) => c.supplierId === supplierId && c.cityId === cityId && c.positionId === line.positionId && c.status === "active")
}

export function PeerComparison({ invoice }: { invoice: Invoice }) {
  const data = useData()
  const { reviewInvoice, requestRateReview } = useStore.getState()
  const [open, setOpen] = useState(false)
  const [decision, setDecision] = useState<Decision>("rate_review")
  const [note, setNote] = useState("")
  const b = invoiceBenchmark(data, invoice.id)
  const sup = supplier(invoice.supplierId)
  const review = invoice.review
  const peers = b.peers.map((p) => {
    const base = invoice.lines.reduce((s, l) => (hasRate(data, p.supplierId, l) ? s + l.amount : s), 0)
    return { ...p, delta: base ? p.amount / base - 1 : 0 }
  })
  const highRates = new Set(invoice.lines.filter((l) => (b.lineDelta.get(l.id) ?? 0) >= ANOMALY_THRESHOLD).map((l) => `${location(l.locationId).cityId}|${l.positionId}`)).size
  const asked = data.rateCards.filter((c) => c.rateReview?.invoiceId === invoice.id)

  const start = (next: Decision) => {
    setDecision(next)
    setNote("")
    setOpen(true)
  }

  const confirm = async () => {
    if (decision === "reviewed") {
      await reviewInvoice(invoice.id, note.trim() || undefined)
      toast.success(`${invoice.number} marked reviewed`, { description: "Cleared for payment." })
      return
    }
    const n = await requestRateReview(invoice.id, note.trim() || undefined)
    if (n) toast.success(`Asked ${sup.shortName} to review ${plural(n, "rate")}`, { description: `${invoice.number} is cleared for payment. New shifts price at whatever ${sup.shortName} answers.` })
  }

  return (
    <Surface elevated data-tour="peer">
      <SurfaceHeader
        title="Compared with other suppliers"
        info={`What the same hours would have cost from the other suppliers with rates for each shift's city and role, weighted by their rating. Invoices ${Math.round(ANOMALY_THRESHOLD * 100)}% or more above it are flagged.`}
        actions={
          review ? (
            <StatusBadge tone={review.status === "reviewed" ? "positive" : "primary"}>
              {review.status === "reviewed" ? <ShieldCheck className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {review.status === "reviewed" ? `Reviewed by ${review.by}` : "Rate review requested"}
            </StatusBadge>
          ) : invoice.status === "open" ? (
            <span className="text-caption-1 text-faded">Review it once Iris issues it on {formatDateShort(invoice.issuedOn)}</span>
          ) : (
            <>
              <Button variant="outline" className="h-8 gap-1.5 rounded-lg text-body-3" onClick={() => start("reviewed")}>
                <ShieldCheck className="size-4" /> Mark reviewed
              </Button>
              <Button className="h-8 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => start("rate_review")} data-tour="rate-review">
                <TrendingDown className="size-4" /> Ask {sup.shortName} to review its rates
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-3 px-5 pt-4 sm:grid-cols-3">
        <Figure label="This invoice" info="Labor only. Tips pass straight through to Pros, so they aren't compared." sub={`${sup.shortName} · score ${b.score}`}>
          {money(b.labor)}
        </Figure>
        <Figure
          label="Benchmark"
          info={`Each line priced at the other suppliers' bill rates for the same city and role, weighted by their scores, then scaled to ${sup.shortName}'s score of ${b.score}.`}
          sub="Rating-weighted"
        >
          {money(b.fair)}
        </Figure>
        <Figure label="Difference" sub={`${money(Math.max(0, b.labor - b.fair))} above benchmark`} className="text-critical-fg">
          {formatDelta(b.deltaPct)}
        </Figure>
      </div>
      <div className="overflow-x-auto px-2 pt-3 pb-3 scrollbar-thin">
        <table className="w-full text-left text-body-3">
          <thead>
            <tr className="text-caption-1 text-faded">
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  Score <InfoTip>Out of 100: fill rate, reliability, compliance and speed to fill.</InfoTip>
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">Would have charged</th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  vs. this invoice <InfoTip>Compared with this invoice&apos;s labor on the hours that supplier has rates for.</InfoTip>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => (
              <tr key={p.supplierId} className="border-t border-border/80">
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <SupplierLogo supplierId={p.supplierId} size="sm" />
                    <span className="flex flex-col">
                      <span className="font-medium">{supplier(p.supplierId).name}</span>
                      {p.coverage < 1 && <span className="text-caption-1 text-faded">Rates for {Math.floor(p.coverage * 100)}% of these hours</span>}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular">{p.score}</td>
                <td className="px-3 py-2.5 text-right tabular">{money(p.amount)}</td>
                <td className="px-3 py-2.5 text-right font-medium tabular">{formatDelta(p.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {asked.length > 0 && (
        <ul className="mx-5 mb-4 flex flex-col gap-1.5 rounded-lg bg-tint-faded px-3 py-2.5 text-body-3">
          {asked.map((c) => {
            const r = c.rateReview!
            return (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span>
                  {position(c.positionId).name}, {city(c.cityId).name}: {money(r.fromRate)}/hr against a market of {money(r.marketRate)}/hr
                </span>
                <span className={cn("font-medium", r.status === "lowered" ? "text-positive-fg" : "text-faded")}>
                  {r.status === "requested" ? `Waiting on ${sup.shortName}` : r.status === "lowered" ? `Lowered to ${money(c.billRate)}/hr` : `Kept: “${r.answer}”`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {review?.note && (
        <p className="mx-5 mb-5 rounded-lg bg-tint-faded px-3 py-2 text-body-3 text-faded">
          Note from {review.by}: “{review.note}”
        </p>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decision === "reviewed" ? `Mark ${invoice.number} reviewed?` : `Ask ${sup.shortName} to review its rates?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision === "reviewed"
                ? "It's cleared for payment and comes off your to-dos."
                : `${invoice.number} is billed at the rates ${buyer(invoice.buyerId).name} agreed to, so it's cleared for payment. ${sup.shortName} is asked to bring ${plural(highRates, "rate")} down to the market or say why not, and new shifts price at its answer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === "reviewed" ? "Add a note (optional)" : `Add a note for ${sup.shortName} (optional)`} className="min-h-20 rounded-lg text-body-3" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>{decision === "reviewed" ? "Mark reviewed" : "Ask for a rate review"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Surface>
  )
}

function Figure({ label, info, sub, className, children }: { label: string; info?: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-tint-faded px-3.5 py-3">
      <span className="flex items-center gap-1 text-caption-1 text-faded">
        {label} {info && <InfoTip>{info}</InfoTip>}
      </span>
      <span className={cn("text-featured-2 font-semibold tabular", className)}>{children}</span>
      {sub && <span className="text-caption-1 text-faded">{sub}</span>}
    </div>
  )
}

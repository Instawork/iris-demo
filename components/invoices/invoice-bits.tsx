"use client"

import { AlertTriangle } from "lucide-react"

import { Tip } from "@/components/common/info-tip"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { useData } from "@/hooks/use-app"
import { ANOMALY_THRESHOLD, invoiceBalance, invoiceBenchmark, invoiceStatus, invoiceTotal, type InvoiceDisplayStatus } from "@/lib/metrics"
import { supplier } from "@/lib/reference"
import type { Invoice, InvoiceGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

export const INVOICE_STATUS: Record<InvoiceDisplayStatus, { label: string; tone: Tone }> = {
  unpaid: { label: "Unpaid", tone: "primary" },
  paid: { label: "Paid", tone: "positive" },
  partial: { label: "Partially paid", tone: "warning" },
  in_process: { label: "In process", tone: "neutral" },
  overdue: { label: "Overdue", tone: "critical" },
}

export function InvoiceStatusBadge({ invoice }: { invoice: Invoice }) {
  const s = INVOICE_STATUS[invoiceStatus(invoice)]
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
}

export const formatDelta = (delta: number) => {
  const pct = Math.trunc(delta * 100)
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`
}

export const anomalyNote = (delta: number) => `${Math.trunc(delta * 100)}% above what other suppliers would have charged, weighted by rating`

export function DeltaText({ delta }: { delta: number }) {
  return <span className={cn("tabular", delta >= ANOMALY_THRESHOLD ? "font-semibold text-critical-fg" : "text-faded")}>{formatDelta(delta)}</span>
}

export function AnomalyFlag({ invoice }: { invoice: Invoice }) {
  const data = useData()
  const { anomalous, deltaPct } = invoiceBenchmark(data, invoice.id)
  if (!anomalous) return null
  const review = invoice.review
  const state = !review
    ? "Needs your review."
    : review.status === "reviewed"
      ? `Reviewed by ${review.by}.`
      : `Sent back to ${supplier(invoice.supplierId).shortName} by ${review.by}.`
  return (
    <Tip content={`${anomalyNote(deltaPct)}. ${state}`}>
      <span
        role="img"
        aria-label="Anomalous invoice"
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md",
          !review ? "bg-critical-faded text-critical-fg" : review.status === "sent_back" ? "text-warning-fg" : "text-subtle",
        )}
      >
        <AlertTriangle className="size-3.5" />
      </span>
    </Tip>
  )
}

export function groupTotals(group: InvoiceGroup, invoices: Invoice[]) {
  const members = invoices.filter((i) => group.invoiceIds.includes(i.id))
  const total = members.reduce((s, i) => s + invoiceTotal(i), 0)
  const balance = members.reduce((s, i) => s + invoiceBalance(i), 0)
  const statuses = members.map((i) => invoiceStatus(i))
  const status: InvoiceDisplayStatus = statuses.every((s) => s === "paid")
    ? "paid"
    : statuses.some((s) => s === "overdue")
      ? "overdue"
      : statuses.some((s) => s === "paid" || s === "partial")
        ? "partial"
        : statuses.every((s) => s === "in_process")
          ? "in_process"
          : "unpaid"
  const dates = members.flatMap((m) => [m.periodStart, m.periodEnd]).sort()
  return { members, total, balance, status, from: dates[0], to: dates[dates.length - 1] }
}

"use client"

import { AlertTriangle } from "lucide-react"

import { Tip } from "@/components/common/info-tip"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { useData } from "@/hooks/use-app"
import { money, plural } from "@/lib/format"
import {
  ANOMALY_THRESHOLD,
  billingFindings,
  creditDue,
  invoiceBalance,
  invoiceBenchmark,
  invoiceStatus,
  invoiceTotal,
  needsReview,
  type InvoiceDisplayStatus,
} from "@/lib/metrics"
import { supplier } from "@/lib/reference"
import type { Invoice, InvoiceGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

export const INVOICE_STATUS: Record<InvoiceDisplayStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "neutral" },
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

export const anomalyNote = (delta: number) => `${Math.trunc(delta * 100)}% above what other agencies would have charged, weighted by rating`

export function DeltaText({ delta }: { delta: number }) {
  return <span className={cn("tabular", delta >= ANOMALY_THRESHOLD ? "font-semibold text-critical-fg" : "text-faded")}>{formatDelta(delta)}</span>
}

/** Where Compass's decision on hours billed above Iris's clock stands. */
export function billingState(invoice: Invoice) {
  const b = invoice.billingReview
  const sup = supplier(invoice.supplierId).shortName
  if (!b) return undefined
  if (b.status === "sent_back") return `Sent back to ${sup} for a ${money(b.amount)} credit by ${b.by}.`
  if (b.status === "credited") return `${sup} credited ${money(b.amount)}.`
  return `Accepted as billed by ${b.by}.`
}

export function AnomalyFlag({ invoice }: { invoice: Invoice }) {
  const data = useData()
  const { anomalous, deltaPct } = invoiceBenchmark(data, invoice.id)
  const findings = billingFindings(data, invoice.id)
  if (!anomalous && !findings.length && !invoice.billingReview) return null
  const review = invoice.review
  const sup = supplier(invoice.supplierId).shortName
  const parts = [
    (findings.length || invoice.billingReview) &&
      (billingState(invoice) ?? `${plural(findings.length, "line")} billed ${money(creditDue(data, invoice))} above Iris's clock. Needs your review.`),
    anomalous &&
      `${anomalyNote(deltaPct)}. ${
        review
          ? review.status === "reviewed"
            ? `Reviewed by ${review.by}.`
            : `${review.by} asked ${sup} to review its rates.`
          : invoice.status === "open"
            ? "Reviewed once it's issued."
            : invoice.status === "paid" || invoice.status === "in_process"
              ? "Paid without a review."
              : "Needs your review."
      }`,
  ].filter(Boolean)
  const waiting = needsReview(data, invoice)
  return (
    <Tip content={parts.join(" ")}>
      <span
        role="img"
        aria-label="Flagged invoice"
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md",
          waiting ? "bg-critical-faded text-critical-fg" : invoice.billingReview?.status === "sent_back" || review?.status === "rate_review" ? "text-warning-fg" : "text-subtle",
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
  const status: InvoiceDisplayStatus = statuses.some((s) => s === "open")
    ? "open"
    : statuses.every((s) => s === "paid")
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

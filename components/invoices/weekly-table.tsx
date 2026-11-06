"use client"

import { AlertTriangle, ChevronRight } from "lucide-react"
import { Fragment, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import type { Column } from "@/components/common/data-table"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { StatusBadge } from "@/components/common/status-badge"
import { INVOICE_STATUS, groupTotals } from "@/components/invoices/invoice-bits"
import { formatDateShort } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { invoiceStatus, type InvoiceDisplayStatus } from "@/lib/metrics"
import type { Invoice, InvoiceGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Every invoice under the week it's consolidated in. Each week is one invoice for all of Compass, laid out in the same
 * columns as the agency invoices inside it: open it for the breakdown, or expand it to see those invoices in place.
 */

const newestFirst = (a: Invoice, b: Invoice) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number)

export function WeeklyTable({
  invoices,
  groups,
  columns,
  toReview,
  onOpenWeek,
  onOpenInvoice,
  empty,
}: {
  invoices: Invoice[]
  groups: InvoiceGroup[]
  columns: Column<Invoice>[]
  toReview?: (invoice: Invoice) => boolean
  onOpenWeek: (groupId: string) => void
  onOpenInvoice: (invoice: Invoice) => void
  empty: React.ReactNode
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const weeks = groups
    .filter((g) => !!g.week)
    .map((g) => ({ g, ...groupTotals(g, invoices) }))
    .filter((m) => m.members.length > 0)
    .sort((a, b) => b.g.week!.localeCompare(a.g.week!))
  const grouped = new Set(weeks.flatMap((m) => m.members.map((i) => i.id)))
  const loose = invoices.filter((i) => !grouped.has(i.id)).sort(newestFirst)
  if (!weeks.length && !loose.length) return <>{empty}</>

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const td = (c: Column<Invoice>) => cn("px-3 py-2.5 align-middle text-body-3 whitespace-nowrap", c.align === "right" && "text-right tabular", c.className)

  const weekCell = (c: Column<Invoice>, m: (typeof weeks)[number]) => {
    const expanded = open.has(m.g.id)
    switch (c.id) {
      case "flag": {
        const n = toReview ? m.members.filter(toReview).length : 0
        return n ? (
          <Tip content={`${plural(n, "invoice")} waiting for your review`}>
            <span className="inline-flex items-center gap-1 text-caption-1 font-semibold text-critical-fg">
              <AlertTriangle className="size-3.5" /> {n}
            </span>
          </Tip>
        ) : null
      }
      case "number":
        return (
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-label={expanded ? `Collapse ${m.g.code}` : `Show the invoices in ${m.g.code}`}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation()
                toggle(m.g.id)
              }}
              className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-faded transition-colors hover:bg-hover hover:text-foreground"
            >
              <ChevronRight className={cn("size-4 transition-transform duration-100", expanded && "rotate-90")} />
            </button>
            <span>
              <code className="font-mono font-semibold">{m.g.code}</code>
              <span className="text-faded">
                {" "}
                · {formatDateShort(m.from)} – {formatDateShort(m.to)}
              </span>
            </span>
          </span>
        )
      case "buyer": {
        const n = new Set(m.members.map((i) => i.buyerId)).size
        return <span className="text-faded">{plural(n, "buyer")}</span>
      }
      case "supplier":
        return (
          <span className="flex items-center gap-2">
            <span className="flex -space-x-1.5">
              {[...new Set(m.members.map((i) => i.supplierId))].map((s) => (
                <SupplierLogo key={s} supplierId={s} size="sm" className="ring-2 ring-card" />
              ))}
            </span>
            <span className="text-faded">{plural(m.members.length, "invoice")}</span>
          </span>
        )
      case "over": {
        const n = m.members.reduce((sum, inv) => sum + Number(c.sortValue?.(inv) ?? 0), 0)
        return n > 0 ? <span data-tour="above-card" className="font-semibold tabular text-critical-fg">{money(n)}</span> : null
      }
      case "amount":
        return (
          <span className="flex flex-col items-end">
            <span className="font-semibold">{money(m.total)}</span>
            {m.balance > 0 && m.balance < m.total && <span className="text-caption-1 text-faded">{money(m.balance)} left</span>}
          </span>
        )
      case "status":
        return <StatusBadge tone={INVOICE_STATUS[m.status].tone}>{INVOICE_STATUS[m.status].label}</StatusBadge>
      default:
        return null
    }
  }

  /** An invoice under its week leaves out what the week already says: its dates, and its status when it's the week's. */
  const nestedCell = (c: Column<Invoice>, inv: Invoice, week: InvoiceDisplayStatus) => {
    if (c.id === "number") return <span className="block pl-7 font-semibold">{inv.number}</span>
    if (c.id === "status" && invoiceStatus(inv) === week) return null
    return c.cell(inv)
  }

  const invoiceRow = (inv: Invoice, week?: InvoiceDisplayStatus) => (
    <tr
      key={inv.id}
      data-row-id={inv.id}
      onClick={() => onOpenInvoice(inv)}
      className={cn("cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-hover", week && "bg-page-faded/50")}
    >
      {columns.map((c) => (
        <td key={c.id} className={td(c)}>
          {week ? nestedCell(c, inv, week) : c.cell(inv)}
        </td>
      ))}
    </tr>
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-raised" data-tour="weekly-invoices">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th key={c.id} className={cn("h-9 px-3 text-caption-1 font-medium whitespace-nowrap text-faded", c.align === "right" && "text-right", c.headerClassName)}>
                  <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.header}
                    {c.info && <InfoTip>{c.info}</InfoTip>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((m) => (
              <Fragment key={m.g.id}>
                <tr
                  data-row-id={m.g.id}
                  onClick={() => onOpenWeek(m.g.id)}
                  className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-hover"
                >
                  {columns.map((c) => (
                    <td key={c.id} className={td(c)}>
                      {weekCell(c, m)}
                    </td>
                  ))}
                </tr>
                {open.has(m.g.id) && [...m.members].sort(newestFirst).map((inv) => invoiceRow(inv, m.status))}
              </Fragment>
            ))}
            {loose.map((inv) => invoiceRow(inv))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

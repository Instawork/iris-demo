"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, FileText, Trash2, Unlink, Wallet } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Breakdown, invoiceItems, placeOf } from "@/components/invoices/breakdown"
import { AnomalyFlag, INVOICE_STATUS, InvoiceStatusBadge, groupTotals } from "@/components/invoices/invoice-bits"
import { TipSplit } from "@/components/invoices/invoice-detail"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatDateShort, formatWeek } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { inScope, invoiceBalance, invoiceHours, invoiceStatus, invoiceTotal, venueTips } from "@/lib/metrics"
import { location, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import { expensesOf } from "@/lib/timesheets"

/** One invoice group on its own page: the week's bill for all of Compass down to each cost center, or a hand-made group of invoices. */
export function InvoiceGroupPage({ id }: { id: string }) {
  const data = useData()
  const router = useRouter()
  const { ws, scope } = useWorkspace()
  const { removeFromGroup, deleteInvoiceGroup, payInvoices } = useStore.getState()
  const [view, setView] = useState<"breakdown" | "tips" | "invoices">("breakdown")
  const live = data.invoiceGroups.find((g) => g.id === id)
  const t = live ? groupTotals(live, data.invoices.filter((i) => inScope(scope, i))) : undefined

  if (!live || !t?.members.length) {
    return (
      <div className="pt-10">
        <EmptyState icon={FileText} title="Invoice group not found" description="It may have been ungrouped, or belong to another workspace." actions={<Button asChild variant="outline"><Link href="/invoices">Back to Invoices</Link></Button>} />
      </div>
    )
  }

  const weekly = !!live.week
  const shown = weekly ? view : "invoices"
  const agencies = new Set(t.members.map((m) => m.supplierId)).size
  const totalHours = t.members.reduce((s, m) => s + invoiceHours(m), 0)
  const canManage = !weekly && ws.kind !== "supplier" && t.members.length === live.invoiceIds.length
  const payable = ws.kind === "buyer" ? t.members.filter((m) => invoiceBalance(m) > 0 && invoiceStatus(m) !== "in_process" && invoiceStatus(m) !== "open") : []
  const payTotal = payable.reduce((s, m) => s + invoiceBalance(m), 0)
  const tips = t.members
    .flatMap((m) => venueTips(m.lines).map((v) => ({ ...v, key: `${m.id}|${v.key}`, invoice: m })))
    .sort((a, b) => b.date.localeCompare(a.date) || a.locationId.localeCompare(b.locationId))
  const download = () =>
    downloadCsv(
      exportName(live.code.toLowerCase()),
      toCsv(
        t.members.flatMap((inv) =>
          inv.lines.map((l) => {
            const [superSector, sector, region, district, unit, dept] = placeOf(inv, l)
            return {
            invoice_group_id: live.code,
            invoice_number: inv.number,
            supplier: supplier(inv.supplierId).name,
            super_sector: superSector.name,
            sector: sector.name,
            region: region.name,
            district: district.name,
            unit: unit.name,
            department: dept?.name ?? "",
            cost_center: dept?.costCenter || unit.costCenter,
            pro: l.proName,
            position: position(l.positionId).name,
            date: l.date,
            hours: l.hours,
            bill_rate: l.billRate.toFixed(2),
            tips: l.tips.toFixed(2),
            expenses: expensesOf(l).toFixed(2),
            amount: (l.amount + l.tips + expensesOf(l)).toFixed(2),
            }
          }),
        ),
      ),
    )

  const stats = [
    { label: "Total", value: money(t.total) },
    { label: "Balance", value: money(t.balance) },
    { label: "Hours", value: Math.round(totalHours).toLocaleString("en-US") },
    { label: "Agencies", value: String(agencies) },
  ]

  return (
    <>
      <div className="flex flex-col gap-4 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2" data-tour="group-title">
            <h1 className="text-featured-1 font-semibold">{weekly ? formatWeek(live.week!) : live.name}</h1>
            <StatusBadge tone={INVOICE_STATUS[t.status].tone}>{INVOICE_STATUS[t.status].label}</StatusBadge>
            {t.status === "open" && (
              <InfoTip>{`Iris adds approved hours and issues it on ${formatDateShort(t.members[0].issuedOn)}.`}</InfoTip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body-3 text-faded">
            <code className="font-mono">{live.code}</code>
            <span>{plural(t.members.length, "invoice")}</span>
            <span>
              {formatDateShort(t.from)} – {formatDateShort(t.to)}
            </span>
            {!weekly && t.status !== "open" && <span>Created by {live.createdBy}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canManage && (
            <Button
              variant="ghost"
              className="h-9 gap-1.5 rounded-lg text-body-3 text-critical-fg"
              onClick={() => {
                deleteInvoiceGroup(live.id)
                toast(`${live.code} ungrouped`, { description: "The invoices are still there, just not grouped." })
                router.push("/invoices")
              }}
            >
              <Trash2 className="size-4" /> Ungroup
            </Button>
          )}
          <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={download}>
            <Download className="size-4" /> Download CSV
          </Button>
          {payable.length > 0 && (
            <Button
              className="h-9 gap-1.5 rounded-lg text-body-3"
              onClick={() => {
                payInvoices(payable.map((m) => m.id))
                toast.success(`Payment scheduled for ${live.code}`, { description: `${money(payTotal)} by ACH` })
              }}
            >
              <Wallet className="size-4" /> Pay {money(payTotal)}
            </Button>
          )}
        </div>
      </div>

      <Surface elevated className="overflow-hidden">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {stats.map((x) => (
            <div key={x.label} className="flex flex-col gap-0.5 bg-card px-5 py-4">
              <span className="text-caption-1 text-faded">{x.label}</span>
              <span className="text-featured-3 font-semibold tabular">{x.value}</span>
            </div>
          ))}
        </div>
      </Surface>

      <Surface elevated className="overflow-hidden" data-tour="group-detail">
        {weekly && (
          <div className="border-b border-border px-5 py-3">
            <PillTabs
              size="sm"
              value={view}
              onChange={setView}
              items={[
                { value: "breakdown", label: "Breakdown" },
                ...(tips.length ? [{ value: "tips" as const, label: "Tips", count: tips.length }] : []),
                { value: "invoices", label: "Invoices", count: t.members.length },
              ]}
            />
          </div>
        )}
        {shown === "breakdown" && (
          <div className="px-3 pb-2">
            <Breakdown items={invoiceItems(t.members)} />
          </div>
        )}
        {shown === "tips" &&
          tips.map((v) => (
            <div key={v.key} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-0" data-tour="venue-tips">
              <SupplierLogo supplierId={v.invoice.supplierId} size="md" />
              <Link href={`/invoices/${v.invoice.id}`} className="flex flex-1 flex-col hover:underline">
                <span className="text-body-3 font-semibold">{location(v.locationId).name} tips</span>
                <span className="text-caption-1 text-faded">
                  {formatDateShort(v.date)} · {v.invoice.number}
                </span>
              </Link>
              <Tip content={<TipSplit workers={v.workers} />}>
                <span className="cursor-default text-body-3 text-faded underline decoration-dotted underline-offset-4">{plural(v.workers.length, "worker")}</span>
              </Tip>
              <span className="w-28 text-right text-body-3 font-semibold tabular">{money(v.amount)}</span>
            </div>
          ))}
        {shown === "invoices" &&
          t.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-0">
              <SupplierLogo supplierId={m.supplierId} size="md" />
              <Link href={`/invoices/${m.id}`} className="flex flex-1 flex-col hover:underline">
                <span className="text-body-3 font-semibold">
                  {m.number} · {supplier(m.supplierId).shortName}
                </span>
                <span className="text-caption-1 text-faded">
                  {plural(m.lines.length, "line")} · {invoiceStatus(m) === "open" ? `issues ${formatDateShort(m.issuedOn)}` : `due ${formatDateShort(m.dueOn)}`}
                </span>
              </Link>
              {ws.kind === "compass" && <AnomalyFlag invoice={m} />}
              <InvoiceStatusBadge invoice={m} />
              <span className="w-28 text-right text-body-3 font-semibold tabular">{money(invoiceTotal(m))}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove from group"
                  onClick={() => {
                    removeFromGroup(m.id)
                    toast(`${m.number} removed from ${live.code}`)
                    if (t.members.length === 1) router.push("/invoices")
                  }}
                >
                  <Unlink className="size-4" />
                </Button>
              )}
            </div>
          ))}
      </Surface>
    </>
  )
}

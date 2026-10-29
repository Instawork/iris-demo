"use client"

import Link from "next/link"
import { Download, Trash2, Unlink, Wallet } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { PillTabs } from "@/components/common/pill-tabs"
import { Breakdown, placeOf } from "@/components/invoices/breakdown"
import { AnomalyFlag, INVOICE_STATUS, InvoiceStatusBadge, groupTotals } from "@/components/invoices/invoice-bits"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatDateShort, formatMonth } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { inScope, invoiceBalance, invoiceStatus, invoiceTotal } from "@/lib/metrics"
import { position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"

export function GroupDetailDialog({ groupId, onOpenChange }: { groupId?: string; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const { removeFromGroup, deleteInvoiceGroup, payInvoices } = useStore.getState()
  const [view, setView] = useState<"breakdown" | "invoices">("breakdown")
  const live = groupId ? data.invoiceGroups.find((g) => g.id === groupId) : undefined
  const t = live ? groupTotals(live, data.invoices.filter((i) => inScope(scope, i))) : undefined
  if (!live || !t?.members.length) return <Dialog open={false} onOpenChange={onOpenChange} />
  const monthly = !!live.month
  const shown = monthly ? view : "invoices"
  const agencies = new Set(t.members.map((m) => m.supplierId)).size
  const canManage = !monthly && ws.kind !== "supplier" && t.members.length === live.invoiceIds.length
  const payable = ws.kind === "buyer" ? t.members.filter((m) => invoiceBalance(m) > 0 && invoiceStatus(m) !== "in_process" && invoiceStatus(m) !== "open") : []
  const payTotal = payable.reduce((s, m) => s + invoiceBalance(m), 0)
  const download = () =>
    downloadCsv(
      exportName(live.code.toLowerCase()),
      toCsv(
        t.members.flatMap((inv) =>
          inv.lines.map((l) => {
            const [superSector, sector, business, unit, dept] = placeOf(inv, l)
            return {
            invoice_group_id: live.code,
            invoice_number: inv.number,
            supplier: supplier(inv.supplierId).name,
            super_sector: superSector.name,
            sector: sector.name,
            regional_business: business.name,
            unit: unit.name,
            department: dept?.name ?? "",
            cost_center: dept?.costCenter || unit.costCenter,
            pro: l.proName,
            position: position(l.positionId).name,
            date: l.date,
            hours: l.hours,
            bill_rate: l.billRate.toFixed(2),
            tips: l.tips.toFixed(2),
            amount: (l.amount + l.tips).toFixed(2),
            }
          }),
        ),
      ),
    )
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86svh] gap-0 overflow-hidden p-0 sm:max-w-2xl" data-tour="group-detail">
        <DialogHeader className="gap-1 border-b border-border px-6 pt-6 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-featured-3 font-bold">{monthly ? formatMonth(live.month!) : live.name}</DialogTitle>
            <StatusBadge tone={INVOICE_STATUS[t.status].tone}>{INVOICE_STATUS[t.status].label}</StatusBadge>
          </div>
          <DialogDescription className="text-body-3">
            <code className="font-mono">{live.code}</code> · {plural(t.members.length, "invoice")}
            {monthly
              ? ` from ${plural(agencies, "agency", "agencies")}${t.status === "open" ? " · Iris adds each week's invoices as it goes" : ""}`
              : ` · ${formatDateShort(t.from)} – ${formatDateShort(t.to)} · ${t.status === "open" ? `open: Iris adds approved hours and issues it on ${formatDateShort(t.members[0].issuedOn)}` : `created by ${live.createdBy}`}`}
          </DialogDescription>
          {monthly && (
            <PillTabs
              size="sm"
              className="mt-2 self-start"
              value={view}
              onChange={setView}
              items={[
                { value: "breakdown", label: "Breakdown" },
                { value: "invoices", label: "Invoices", count: t.members.length },
              ]}
            />
          )}
        </DialogHeader>
        <div className="max-h-[52svh] overflow-y-auto scrollbar-thin">
          {shown === "breakdown" && (
            <div className="px-4 py-2">
              <Breakdown invoices={t.members} />
            </div>
          )}
          {shown === "invoices" && t.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-border px-6 py-3 last:border-0">
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
              <span className="w-24 text-right text-body-3 font-semibold tabular">{money(invoiceTotal(m))}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove from group"
                  onClick={() => {
                    removeFromGroup(m.id)
                    toast(`${m.number} removed from ${live.code}`)
                    if (t.members.length === 1) onOpenChange(false)
                  }}
                >
                  <Unlink className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="mx-0 mb-0 flex-wrap items-center px-6 py-4 sm:justify-between">
          <span className="text-body-3">
            Total <span className="font-bold tabular">{money(t.total)}</span> · Balance <span className="font-bold tabular">{money(t.balance)}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <Button
                variant="ghost"
                className="text-critical-fg"
                onClick={() => {
                  deleteInvoiceGroup(live.id)
                  toast(`${live.code} ungrouped`, { description: "The invoices are still there, just not grouped." })
                  onOpenChange(false)
                }}
              >
                <Trash2 className="size-4" /> Ungroup
              </Button>
            )}
            <Button variant="outline" onClick={download}>
              <Download className="size-4" /> Download CSV
            </Button>
            {payable.length > 0 && (
              <Button
                onClick={() => {
                  payInvoices(payable.map((m) => m.id))
                  toast.success(`Payment scheduled for ${live.code}`, { description: `${money(payTotal)} by ACH` })
                }}
              >
                <Wallet className="size-4" /> Pay {money(payTotal)}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

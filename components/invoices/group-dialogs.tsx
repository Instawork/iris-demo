"use client"

import Link from "next/link"
import { Download, Layers, Trash2, Unlink, Wallet } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { AnomalyFlag, INVOICE_STATUS, InvoiceStatusBadge, groupTotals } from "@/components/invoices/invoice-bits"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatDateShort } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { inScope, invoiceBalance, invoiceStatus, invoiceTotal } from "@/lib/metrics"
import { buyer, location, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"

export function CreateGroupDialog({
  open,
  onOpenChange,
  invoiceIds,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceIds: string[]
  onCreated: (groupId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <CreateGroupBody invoiceIds={invoiceIds} onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}

function CreateGroupBody({ invoiceIds, onClose, onCreated }: { invoiceIds: string[]; onClose: () => void; onCreated: (groupId: string) => void }) {
  const data = useData()
  const create = useStore((s) => s.createInvoiceGroup)
  const members = useMemo(() => data.invoices.filter((i) => invoiceIds.includes(i.id)), [data.invoices, invoiceIds])
  const buyers = [...new Set(members.map((m) => m.buyerId))]
  const starts = members.map((m) => m.periodStart).sort()
  const [name, setName] = useState(() => (members.length ? `${buyers.length === 1 ? buyer(buyers[0]).name : "Multi-buyer"}, week of ${formatDateShort(starts[0])}` : ""))
  const [code] = useState(() => `IG-2026-${String(data.counters.ig).padStart(3, "0")}`)
  const [moving] = useState(() => members.filter((m) => m.groupId).length)
  const total = members.reduce((s, i) => s + invoiceTotal(i), 0)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Group into a consolidated invoice</DialogTitle>
        <DialogDescription>Review and pay {plural(members.length, "invoice")} as one. Each invoice keeps its own lines.</DialogDescription>
      </DialogHeader>
      <label className="flex flex-col gap-1.5">
        <span className="text-body-3 font-semibold">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-lg border border-input px-3 text-body-3 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
        <span className="text-caption-1 text-faded">
          Invoice group ID <code className="font-mono">{code}</code>
        </span>
      </label>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border scrollbar-thin">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-body-3 last:border-0">
            <SupplierLogo supplierId={m.supplierId} size="sm" />
            <span className="flex flex-1 flex-col">
              <span className="font-semibold">{m.number}</span>
              <span className="text-caption-1 text-faded">
                {supplier(m.supplierId).shortName} · {formatDateShort(m.periodStart)} – {formatDateShort(m.periodEnd)}
              </span>
            </span>
            <span className="font-semibold tabular">{money(invoiceTotal(m))}</span>
          </div>
        ))}
      </div>
      {buyers.length > 1 && <p className="rounded-lg bg-warning-faded px-3 py-2 text-caption-1 text-warning-fg">These invoices are for more than one buyer. Consolidated invoices are usually per buyer.</p>}
      {moving > 0 && <p className="rounded-lg bg-tint-faded px-3 py-2 text-caption-1 text-faded">{moving} of these are already in a group and will move to the new one.</p>}
      <DialogFooter className="items-center sm:justify-between">
        <span className="text-body-3">
          Total <span className="font-bold tabular">{money(total)}</span>
        </span>
        <Button
          disabled={!members.length || !name.trim()}
          onClick={async () => {
            const id = await create(name.trim(), invoiceIds)
            if (!id) return
            toast.success(`${id.toUpperCase()} created`, { description: `${plural(members.length, "invoice")} · ${money(total)}` })
            onClose()
            onCreated(id)
          }}
        >
          <Layers className="size-4" /> Create group
        </Button>
      </DialogFooter>
    </>
  )
}

export function GroupDetailDialog({ groupId, onOpenChange }: { groupId?: string; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const { removeFromGroup, deleteInvoiceGroup, payInvoices } = useStore.getState()
  const live = groupId ? data.invoiceGroups.find((g) => g.id === groupId) : undefined
  const t = live ? groupTotals(live, data.invoices.filter((i) => inScope(scope, i))) : undefined
  if (!live || !t?.members.length) return <Dialog open={false} onOpenChange={onOpenChange} />
  const canManage = ws.kind !== "supplier" && t.members.length === live.invoiceIds.length
  const payable = ws.kind === "buyer" ? t.members.filter((m) => invoiceBalance(m) > 0 && invoiceStatus(m) !== "in_process" && invoiceStatus(m) !== "open") : []
  const payTotal = payable.reduce((s, m) => s + invoiceBalance(m), 0)
  const download = () =>
    downloadCsv(
      exportName(live.code.toLowerCase()),
      toCsv(
        t.members.flatMap((inv) =>
          inv.lines.map((l) => ({
            invoice_group_id: live.code,
            invoice_number: inv.number,
            supplier: supplier(inv.supplierId).name,
            pro: l.proName,
            position: position(l.positionId).name,
            location: location(l.locationId).name,
            date: l.date,
            hours: l.hours,
            bill_rate: l.billRate.toFixed(2),
            tips: l.tips.toFixed(2),
            amount: (l.amount + l.tips).toFixed(2),
          })),
        ),
      ),
    )
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="gap-1 border-b border-border px-5 pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-featured-3 font-bold">{live.name}</DialogTitle>
            <StatusBadge tone={INVOICE_STATUS[t.status].tone}>{INVOICE_STATUS[t.status].label}</StatusBadge>
          </div>
          <DialogDescription className="text-body-3">
            <code className="font-mono">{live.code}</code> · {plural(t.members.length, "invoice")} · {formatDateShort(t.from)} – {formatDateShort(t.to)} ·{" "}
            {t.status === "open"
              ? `open: Iris adds approved hours and issues it on ${formatDateShort(t.members[0].issuedOn)}`
              : live.weekStart
                ? "kept by Iris for the week"
                : `created by ${live.createdBy}`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[52svh] overflow-y-auto scrollbar-thin">
          {t.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
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
        <DialogFooter className="mx-0 mb-0 flex-wrap items-center px-5 py-3 sm:justify-between">
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

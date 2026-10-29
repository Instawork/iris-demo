"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Download, FileText, ShieldCheck, Wallet, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { MultiSelectFilter, ResetFilters, SearchInput } from "@/components/common/filters"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { GroupDetailDialog } from "@/components/invoices/group-dialogs"
import { AnomalyFlag, DeltaText, InvoiceStatusBadge } from "@/components/invoices/invoice-bits"
import { MonthlyTable } from "@/components/invoices/monthly-table"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatDateShort, todayISO } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import {
  billingToReview,
  inScope,
  invoiceBalance,
  invoiceBenchmark,
  invoiceHours,
  invoiceStatus,
  invoiceSubtotal,
  invoiceTips,
  invoiceTotal,
  isFlagged,
  needsReview,
  type InvoiceDisplayStatus,
} from "@/lib/metrics"
import { BUYERS, SUPPLIERS, buyer, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { Invoice, PersonaKind } from "@/lib/types"
import { cn } from "@/lib/utils"

type Quick = "all" | "flagged" | "open" | "outstanding" | "paid"

const QUICK: Record<PersonaKind, Quick[]> = {
  compass: ["all", "flagged", "open", "outstanding", "paid"],
  buyer: ["all", "open", "outstanding", "paid"],
  supplier: ["all", "open", "outstanding", "paid"],
}

const QUICK_LABEL: Record<Quick, string> = { all: "All", flagged: "Flagged", open: "This week", outstanding: "Outstanding", paid: "Paid" }

const OUTSTANDING: InvoiceDisplayStatus[] = ["unpaid", "partial", "overdue"]

const DESCRIPTION: Record<PersonaKind, string> = {
  compass:
    "Every invoice in the program, built from approved hours at each agency's rates. Iris flags hours billed above its clock, which go back to the agency for a credit, and invoices priced well above what other agencies charge.",
  buyer: "Each agency's invoice for the week fills as you approve hours, and Iris issues it on Saturday. Every month rolls into one consolidated invoice, so there's nothing to upload.",
  supplier: "What you're owed. Your invoice for the week fills as the buyer approves your hours, and Iris issues it on Saturday.",
}

const when = <T,>(show: boolean, column: Column<T>) => (show ? [column] : [])

const newestFirst = (a: Invoice, b: Invoice) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number)

function setParams(patch: Record<string, string | undefined>) {
  const next = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  const query = next.toString()
  window.history.replaceState(null, "", query ? `/invoices?${query}` : "/invoices")
}

export function InvoicesPage() {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const router = useRouter()
  const params = useSearchParams()
  const payInvoices = useStore((s) => s.payInvoices)
  const [query, setQuery] = useState("")
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [buyers, setBuyers] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const isCompass = ws.kind === "compass"
  const canSelect = ws.kind === "buyer"
  const quickOptions = QUICK[ws.kind]
  const asked = params.get("filter")
  const quick = quickOptions.find((q) => q === asked) ?? (asked === "overdue" ? "outstanding" : "all")
  const openGroupId = params.get("group") ?? undefined

  const mine = useMemo(() => data.invoices.filter((i) => inScope(scope, i)), [data.invoices, scope])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mine.filter((i) => {
      if (suppliers.length && !suppliers.includes(i.supplierId)) return false
      if (buyers.length && !buyers.includes(i.buyerId)) return false
      if (q && !`${i.number} ${supplier(i.supplierId).name} ${buyer(i.buyerId).name}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [mine, suppliers, buyers, query])
  const matches = useMemo<Record<Quick, (i: Invoice) => boolean>>(
    () => ({
      all: () => true,
      flagged: (i) => needsReview(data, i),
      open: (i) => invoiceStatus(i) === "open",
      outstanding: (i) => OUTSTANDING.includes(invoiceStatus(i)),
      paid: (i) => invoiceStatus(i) === "paid",
    }),
    [data],
  )
  const rows = useMemo(() => {
    const list = filtered.filter(matches[quick])
    if (quick !== "flagged") return list.sort(newestFirst)
    return list.sort((a, b) => Number(billingToReview(data, b)) - Number(billingToReview(data, a)) || newestFirst(a, b))
  }, [data, filtered, matches, quick])
  const groupOf = useMemo(() => new Map(data.invoiceGroups.map((g) => [g.id, g])), [data.invoiceGroups])
  const byMonth = ws.kind !== "supplier" && quick === "all"

  const hasFilters = !!query || suppliers.length + buyers.length > 0
  const resetFilters = () => {
    setQuery("")
    setSuppliers([])
    setBuyers([])
  }
  const billed = rows.reduce((s, i) => s + invoiceTotal(i), 0)
  const open = rows.reduce((s, i) => s + invoiceBalance(i), 0)
  const chosen = rows.filter((i) => selected.has(i.id))
  const payable = ws.kind === "buyer" ? chosen.filter((i) => invoiceBalance(i) > 0 && invoiceStatus(i) !== "in_process" && invoiceStatus(i) !== "open") : []
  const payTotal = payable.reduce((s, i) => s + invoiceBalance(i), 0)

  const columns: Column<Invoice>[] = [
    ...when<Invoice>(isCompass, {
      id: "flag",
      header: "Flag",
      sortValue: (i) => (needsReview(data, i) ? 2 : isFlagged(data, i) ? 1 : 0),
      cell: (i) => <AnomalyFlag invoice={i} />,
      className: "w-12",
    }),
    {
      id: "number",
      header: "Invoice",
      sortValue: (i) => i.number,
      cell: (i) => {
        return (
          <span className="flex flex-col">
            <span className="font-semibold">{i.number}</span>
            <span className="text-caption-1 text-faded">
              {formatDateShort(i.periodStart)} – {formatDateShort(i.periodEnd)}
            </span>
          </span>
        )
      },
    },
    ...when<Invoice>(ws.kind !== "buyer", {
      id: "buyer",
      header: "Buyer",
      sortValue: (i) => buyer(i.buyerId).name,
      cell: (i) => buyer(i.buyerId).name,
    }),
    ...when<Invoice>(ws.kind !== "supplier", {
      id: "supplier",
      header: "Agency",
      sortValue: (i) => supplier(i.supplierId).shortName,
      cell: (i) => (
        <span className="inline-flex items-center gap-2">
          <SupplierLogo supplierId={i.supplierId} size="sm" />
          {supplier(i.supplierId).shortName}
        </span>
      ),
    }),
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (i) => invoiceTotal(i),
      cell: (i) => {
        const total = invoiceTotal(i)
        const balance = invoiceBalance(i)
        return (
          <span className="flex flex-col items-end">
            <span className="font-semibold">{money(total)}</span>
            {balance > 0 && balance < total && <span className="text-caption-1 text-faded">{money(balance)} left</span>}
          </span>
        )
      },
    },
    ...when<Invoice>(isCompass, {
      id: "vs",
      header: "vs. others",
      info: "This invoice's labor compared with what the other agencies would have charged for the same hours, weighted by their rating.",
      align: "right",
      sortValue: (i) => invoiceBenchmark(data, i.id).deltaPct,
      cell: (i) => <DeltaText delta={invoiceBenchmark(data, i.id).deltaPct} />,
    }),
    { id: "status", header: "Status", sortValue: (i) => invoiceStatus(i), cell: (i) => <InvoiceStatusBadge invoice={i} /> },
    {
      id: "due",
      header: "Due",
      sortValue: (i) => i.dueOn,
      cell: (i) => {
        const s = invoiceStatus(i)
        if (s === "open") return <span className="text-faded">Issues {formatDateShort(i.issuedOn)}</span>
        return <span className={cn(s === "overdue" && "font-semibold text-critical-fg", s === "paid" && "text-faded")}>{formatDateShort(i.dueOn)}</span>
      },
    },
  ]

  const exportCsv = () => {
    downloadCsv(
      exportName("invoices"),
      toCsv(
        rows.map((i) => {
          const b = invoiceBenchmark(data, i.id)
          return {
            invoice_number: i.number,
            invoice_group_id: (i.groupId && groupOf.get(i.groupId)?.code) || "",
            buyer: buyer(i.buyerId).name,
            supplier: supplier(i.supplierId).name,
            period_start: i.periodStart,
            period_end: i.periodEnd,
            issue_date: i.issuedOn,
            due_date: i.dueOn,
            status: invoiceStatus(i),
            hours: invoiceHours(i),
            labor: invoiceSubtotal(i).toFixed(2),
            tips: invoiceTips(i).toFixed(2),
            amount: invoiceTotal(i).toFixed(2),
            balance: invoiceBalance(i).toFixed(2),
            ...(isCompass
              ? { benchmark: b.fair.toFixed(2), vs_others_pct: (b.deltaPct * 100).toFixed(1), flagged: b.anomalous ? "yes" : "no", review: i.review?.status ?? "" }
              : {}),
          }
        }),
      ),
    )
  }

  const invoicesEmpty =
    quick === "flagged" && !hasFilters ? (
      <EmptyState icon={ShieldCheck} title="Nothing to review" description="No anomalous invoices are waiting for you." />
    ) : !mine.length ? (
      <EmptyState icon={FileText} title="No invoices yet" description={ws.kind === "supplier" ? "Invoices appear here as buyers approve your hours." : "Invoices appear here as hours are approved."} />
    ) : (
      <EmptyState
        icon={FileText}
        title="No invoices"
        description="Nothing matches these filters."
        actions={
          hasFilters ? (
            <Button variant="outline" onClick={resetFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    )

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Invoices"
        description={DESCRIPTION[ws.kind]}
        actions={
          <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3" disabled={!rows.length} onClick={exportCsv}>
            <Download className="size-4" /> Download CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          size="sm"
          value={quick}
          onChange={(v) => {
            setSelected(new Set())
            setParams({ tab: undefined, filter: v === "all" ? undefined : v })
          }}
          items={quickOptions
            .filter((q) => q !== "open" || quick === "open" || filtered.some(matches.open))
            .map((q) => ({
              value: q,
              label: QUICK_LABEL[q],
              count: q === "all" || q === "paid" ? undefined : filtered.filter(matches[q]).length,
              tooltip:
                q === "flagged"
                  ? "Anomalous invoices waiting for your review"
                  : q === "all" && ws.kind !== "supplier"
                    ? "One invoice a month, broken down by sector, business and cost center"
                    : undefined,
            }))}
        />
        <span className="text-body-3 text-faded">
          <span className="font-bold text-foreground tabular">{money(billed)}</span> billed · <span className="font-bold text-foreground tabular">{money(open)}</span> open
        </span>
      </div>
      <motion.div key={byMonth ? "months" : "invoices"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search invoices" className="w-52" />
          {ws.kind !== "supplier" && (
            <MultiSelectFilter
              label="Agencies"
              options={SUPPLIERS.map((s) => ({ value: s.id, label: s.name, icon: <SupplierLogo supplierId={s.id} size="xs" /> }))}
              value={suppliers}
              onChange={setSuppliers}
            />
          )}
          {ws.kind !== "buyer" && <MultiSelectFilter label="Buyers" options={BUYERS.map((b) => ({ value: b.id, label: b.name }))} value={buyers} onChange={setBuyers} />}
          <ResetFilters show={hasFilters} onClick={resetFilters} />
        </div>
        {byMonth ? (
          <MonthlyTable
            invoices={rows}
            groups={data.invoiceGroups}
            columns={columns}
            toReview={isCompass ? (i) => needsReview(data, i) : undefined}
            onOpenMonth={(id) => setParams({ group: id })}
            onOpenInvoice={(i) => router.push(`/invoices/${i.id}`)}
            empty={invoicesEmpty}
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(i) => i.id}
            selectable={canSelect}
            selected={selected}
            onSelectedChange={setSelected}
            onRowClick={(i) => router.push(`/invoices/${i.id}`)}
            pageSize={15}
            empty={invoicesEmpty}
          />
        )}
      </motion.div>

      <AnimatePresence>
        {payable.length > 0 && !byMonth && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-foreground px-4 py-2.5 text-background shadow-overlay"
          >
            <span className="text-body-3 font-semibold">
              {chosen.length} selected · {money(chosen.reduce((s, i) => s + invoiceTotal(i), 0))}
            </span>
            <Button
              size="sm"
              className="h-8 gap-1.5 rounded-lg bg-brand text-brand-foreground hover:bg-brand/90"
              onClick={() => {
                payInvoices(payable.map((i) => i.id))
                toast.success(`Payment scheduled for ${plural(payable.length, "invoice")}`, { description: `${money(payTotal)} by ACH on ${formatDateShort(todayISO())}` })
                setSelected(new Set())
              }}
            >
              <Wallet className="size-4" /> Pay {money(payTotal)}
            </Button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-md p-1 text-background/70 hover:bg-background/10 hover:text-background" aria-label="Clear selection">
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <GroupDetailDialog groupId={openGroupId} onOpenChange={(o) => !o && setParams({ group: undefined })} />
    </>
  )
}

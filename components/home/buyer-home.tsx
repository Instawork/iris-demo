"use client"

import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, BellRing, Download, Scale } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { InfoTip } from "@/components/common/info-tip"
import { SectionTitle } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Greeting, TodoSection } from "@/components/home/shared"
import { SupplierProfileDialog } from "@/components/home/supplier-profile-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { addDaysISO, formatDateShort, todayISO } from "@/lib/dates"
import { money, moneyWhole, pct } from "@/lib/format"
import { avgBillRate, metricsFor, spendSummaryFor, todosFor, type SpendSlice } from "@/lib/metrics"
import { SUPPLIERS, location, locationsFor, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function BuyerHome() {
  const data = useData()
  const { ws } = useWorkspace()
  const todos = useMemo(() => todosFor(data, ws), [data, ws])
  const locations = locationsFor(ws.buyerId)

  return (
    <>
      <Greeting
        subtitle={`${ws.name} · ${locations.length} locations · ${(data.approvals[ws.buyerId!] ?? []).length} approved suppliers`}
        actions={
          <Button asChild variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold">
            <Link href="/rates">
              <Scale className="size-4" /> Compare rates
            </Link>
          </Button>
        }
      />
      <TodoSection todos={todos} />
      <SpendSection />
      <MySuppliers />
    </>
  )
}

type SpendTab = "supplier" | "position" | "location" | "hours"

const change = (now: number, before: number) => (before > 0 ? now / before - 1 : undefined)

function Figure({ label, info, value, delta, vs }: { label: string; info: string; value: number; delta?: number; vs: string }) {
  const Icon = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="flex items-center gap-1.5 text-body-3 text-faded">
        {label} <InfoTip>{info}</InfoTip>
      </span>
      <span className="text-[28px] leading-9 font-semibold tracking-[-0.035em] tabular">{moneyWhole(value)}</span>
      <span className="flex items-center gap-1 text-caption-1 text-faded">
        {delta === undefined ? (
          "No spend in the prior period"
        ) : Math.abs(delta) < 0.005 ? (
          `Same as ${vs.replace("vs. ", "")}`
        ) : (
          <>
            <Icon className="size-3.5" />
            <span className="font-medium text-foreground tabular">{pct(Math.abs(delta))}</span> {delta >= 0 ? "up" : "down"} {vs}
          </>
        )}
      </span>
    </div>
  )
}

function SpendSection() {
  const data = useData()
  const { scope } = useWorkspace()
  const s = useMemo(() => spendSummaryFor(data, scope), [data, scope])
  const [tab, setTab] = useState<SpendTab>("supplier")
  const total = s.approved + s.pending

  const rows = useMemo(() => {
    const label = (slice: SpendSlice) =>
      tab === "supplier" ? supplier(slice.id).shortName : tab === "position" ? position(slice.id).name : location(slice.id).name
    if (tab === "hours")
      return s.weeks.map((w, i) => ({
        id: w.from,
        label: i === s.weeks.length - 1 ? "This week" : `Week of ${formatDateShort(w.from)}`,
        amount: w.amount,
        meta: `${Math.round(w.hours).toLocaleString()} hrs · ${w.headcount} Pros`,
        bar: w.hours,
      }))
    const list = tab === "supplier" ? s.bySupplier : tab === "position" ? s.byPosition : s.byLocation
    return list.map((slice) => ({
      id: slice.id,
      label: label(slice),
      amount: slice.amount,
      meta: tab === "supplier" ? `${money(slice.avgBillRate)}/hr avg` : `${Math.round(slice.hours).toLocaleString()} hrs · ${slice.headcount} Pros`,
      bar: slice.amount,
    }))
  }, [s, tab])
  const max = Math.max(1, ...rows.map((r) => r.bar))

  const download = () => {
    downloadCsv(
      exportName(`spend-by-${tab}`),
      toCsv(rows.map((r) => ({ [tab === "hours" ? "week" : tab]: r.label, spend: r.amount.toFixed(2), detail: r.meta }))),
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        title="Spend"
        info="Labor and tips for hours worked at your locations. Pending is hours you haven't approved yet."
        actions={
          <Button variant="ghost" size="sm" className="text-faded" onClick={download}>
            <Download /> Download
          </Button>
        }
      />
      <Surface elevated>
        <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Figure label="This month" info="Month to date, compared with the same days last month." value={s.month} delta={change(s.month, s.priorMonth)} vs="vs. last month" />
          <Figure label="Last 7 days" info="The last 7 days, compared with the 7 days before." value={s.week} delta={change(s.week, s.priorWeek)} vs="vs. the week before" />
          <div className="flex flex-col gap-2 px-5 py-4">
            <span className="flex items-center gap-1.5 text-body-3 text-faded">
              Approved vs. pending <InfoTip>This month. Pending hours are submitted or waiting on a supplier, and haven&apos;t been approved yet.</InfoTip>
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-1 font-semibold tabular">{moneyWhole(s.approved)}</span>
              <Link href="/shifts?filter=hours" className="text-body-3 text-faded tabular transition-colors hover:text-foreground">
                {moneyWhole(s.pending)} pending
              </Link>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="h-full bg-foreground" style={{ width: `${total ? (s.approved / total) * 100 : 0}%` }} />
              <span className="h-full bg-brand" style={{ width: `${total ? (s.pending / total) * 100 : 0}%` }} />
            </div>
            <span className="flex items-center gap-3 text-caption-1 text-faded">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-foreground" /> Approved
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-brand" /> Pending
              </span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 pt-4 pb-3">
          <PillTabs
            size="sm"
            value={tab}
            onChange={setTab}
            items={[
              { value: "supplier", label: "By supplier" },
              { value: "position", label: "By position" },
              { value: "location", label: "By location" },
              { value: "hours", label: "Hours & headcount" },
            ]}
            className="self-start"
          />
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-border/70 py-2.5 last:border-0">
                <span className="flex min-w-0 items-center gap-2.5">
                  {tab === "supplier" && <SupplierLogo supplierId={r.id} size="sm" />}
                  <span className="truncate text-body-3 font-medium">{r.label}</span>
                  <span className="hidden truncate text-caption-1 text-faded sm:inline">{r.meta}</span>
                </span>
                <span className="text-body-3 font-semibold tabular">{moneyWhole(r.amount)}</span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn("block h-full rounded-full", tab === "supplier" ? "" : "bg-foreground/80")}
                    style={{ width: `${(r.bar / max) * 100}%`, background: tab === "supplier" ? supplier(r.id).color : undefined }}
                  />
                </span>
              </li>
            ))}
            {!rows.length && <li className="py-6 text-center text-body-3 text-faded">No spend this month yet.</li>}
          </ul>
        </div>
      </Surface>
    </section>
  )
}

interface SupplierRow {
  id: string
  approved: boolean
  spend: number
  billRate: number
  fillRate: number
  noShowRate: number
  compliance: number
  worked: boolean
}

function MySuppliers() {
  const data = useData()
  const { ws } = useWorkspace()
  const setApproval = useStore((s) => s.setSupplierApproval)
  const [profile, setProfile] = useState<string>()
  const buyerId = ws.buyerId!
  const cityIds = useMemo(() => [...new Set(locationsFor(buyerId).map((l) => l.cityId))], [buyerId])

  const rows = useMemo<SupplierRow[]>(() => {
    const from = addDaysISO(todayISO(), -28)
    const approved = data.approvals[buyerId] ?? []
    return SUPPLIERS.filter((s) => s.cityIds.some((c) => cityIds.includes(c)))
      .map((s) => {
        const m = metricsFor(data, s.id, buyerId)
        const spend = data.timesheets
          .filter((t) => t.buyerId === buyerId && t.supplierId === s.id && t.date >= from)
          .reduce((sum, t) => sum + t.hours * t.billRate + t.tips, 0)
        return {
          id: s.id,
          approved: approved.includes(s.id),
          spend,
          billRate: avgBillRate(data, s.id, cityIds),
          fillRate: m.fillRate,
          noShowRate: m.noShowRate,
          compliance: m.compliance,
          worked: m.slotsFilled > 0,
        }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [data, buyerId, cityIds])

  const toggle = (id: string, on: boolean) => {
    setApproval(buyerId, id, on)
    const name = supplier(id).shortName
    toast.success(on ? `${name} approved` : `${name} removed`, {
      description: on ? `${name} will be notified when you post a shift.` : `${name} won't see your new shifts. Shifts it already has stay as they are.`,
    })
  }

  const columns: Column<SupplierRow>[] = [
    {
      id: "approve",
      header: "Approve",
      info: "Checked suppliers are notified when you post a shift.",
      className: "w-20",
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()} className="flex">
          <Checkbox checked={r.approved} onCheckedChange={(v) => toggle(r.id, v === true)} aria-label={`Approve ${supplier(r.id).shortName}`} />
        </span>
      ),
    },
    {
      id: "supplier",
      header: "Supplier",
      sortValue: (r) => supplier(r.id).shortName,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <SupplierLogo supplierId={r.id} size="sm" />
          <span className="font-medium">{supplier(r.id).shortName}</span>
          {!r.approved && (
            <StatusBadge tone="neutral" size="sm">
              Not approved
            </StatusBadge>
          )}
        </span>
      ),
    },
    { id: "spend", header: "Spend", info: "Last 28 days at your locations.", align: "right", sortValue: (r) => r.spend, cell: (r) => <span className="tabular">{moneyWhole(r.spend)}</span> },
    {
      id: "rate",
      header: "Bill rate",
      info: "Average bill rate across the roles this supplier staffs in your cities.",
      align: "right",
      sortValue: (r) => r.billRate,
      cell: (r) => <span className="tabular">{r.billRate ? `${money(r.billRate)}/hr` : "--"}</span>,
    },
    { id: "fill", header: "Fill rate", align: "right", sortValue: (r) => r.fillRate, cell: (r) => <span className="tabular">{r.worked ? pct(r.fillRate) : "--"}</span> },
    { id: "noshow", header: "No show", align: "right", sortValue: (r) => r.noShowRate, cell: (r) => <span className="tabular">{r.worked ? pct(r.noShowRate, 1) : "--"}</span> },
    { id: "compliance", header: "Compliance", align: "right", sortValue: (r) => r.compliance, cell: (r) => <span className="tabular">{pct(r.compliance)}</span> },
  ]

  const download = () =>
    downloadCsv(
      exportName("my-suppliers"),
      toCsv(
        rows.map((r) => ({
          supplier: supplier(r.id).name,
          approved: r.approved ? "yes" : "no",
          spend_28_days: r.spend.toFixed(2),
          avg_bill_rate: r.billRate.toFixed(2),
          fill_rate: pct(r.fillRate),
          no_show_rate: pct(r.noShowRate, 1),
          compliance: pct(r.compliance),
        })),
      ),
    )

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        title="My suppliers"
        info="Ranked by spend. Metrics come only from shifts each supplier filled at your locations, last 28 days."
        actions={
          <Button variant="ghost" size="sm" className="text-faded" onClick={download}>
            <Download /> Download
          </Button>
        }
      />
      <Surface elevated className="overflow-hidden">
        <DataTable rows={rows} columns={columns} getRowId={(r) => r.id} onRowClick={(r) => setProfile(r.id)} />
        <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-caption-1 text-faded">
          <BellRing className="size-3.5" /> Checked suppliers are notified when you post a shift.
        </div>
      </Surface>
      <SupplierProfileDialog supplierId={profile} onOpenChange={(open) => !open && setProfile(undefined)} />
    </section>
  )
}

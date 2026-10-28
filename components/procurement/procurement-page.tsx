"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FileSearch, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatCard } from "@/components/common/stat-card"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { NewEventDialog } from "@/components/procurement/new-event-dialog"
import { Responders, StageBadge, agencyStatus, moneyYear } from "@/components/procurement/sourcing-bits"
import { RatesPage } from "@/components/rates/rates-page"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { daysFromToday, formatDateShort, todayISO } from "@/lib/dates"
import { pct } from "@/lib/format"
import { marketName, openCounters, responded, spendOf, stageOf } from "@/lib/sourcing"
import type { SourcingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

type Tab = "events" | "rates"

const compact = (n: number) => (Math.abs(n) >= 1e6 ? { value: n / 1e6, decimals: 2, suffix: "M" } : { value: n / 1e3, decimals: 0, suffix: "K" })

/**
 * Procurement: Compass runs sourcing events with its agencies, and the rate cards they produce sit beside them. An
 * agency sees the events it's invited to and its own rate cards.
 */
export function ProcurementPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(params.get("tab") === "rates" ? "rates" : "events")
  const [creating, setCreating] = useState(false)
  const isAgency = ws.kind === "supplier"
  const events = useMemo(() => (data.sourcing ?? []).filter((e) => !isAgency || e.invited.includes(ws.supplierId!)), [data.sourcing, isAgency, ws.supplierId])

  const change = (next: Tab) => {
    setTab(next)
    router.replace(next === "rates" ? "/procurement?tab=rates" : "/procurement", { scroll: false })
  }

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Procurement"
        description={
          isAgency
            ? "Compass's invitations to bid, and your rate cards. Approved bids go live on your rate card."
            : "Invite agencies to bid, compare and negotiate line by line, then approve. Approved bids become rate cards."
        }
        actions={
          !isAgency &&
          tab === "events" && (
            <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => setCreating(true)} data-tour="new-event">
              <Plus className="size-4" /> New event
            </Button>
          )
        }
      />
      <PillTabs
        value={tab}
        onChange={change}
        items={[
          { value: "events", label: isAgency ? "Invitations" : "Sourcing events", count: events.filter((e) => e.status === "open").length },
          { value: "rates", label: isAgency ? "My rate cards" : "Rate cards" },
        ]}
      />
      {tab === "rates" ? <RatesPage embedded /> : isAgency ? <Invitations events={events} supplierId={ws.supplierId!} /> : <Events events={events} />}
      {!isAgency && <NewEventDialog open={creating} onOpenChange={setCreating} />}
    </>
  )
}

function Events({ events }: { events: SourcingEvent[] }) {
  const router = useRouter()
  const today = todayISO()
  const live = events.filter((e) => e.status === "open")
  const totals = live.reduce(
    (t, e) => {
      const s = spendOf(e)
      return { baseline: t.baseline + s.baseline, savings: t.savings + s.savings, bids: t.bids + responded(e).length, invited: t.invited + e.invited.length, counters: t.counters + openCounters(e).length }
    },
    { baseline: 0, savings: 0, bids: 0, invited: 0, counters: 0 },
  )

  const columns: Column<SourcingEvent>[] = [
    {
      id: "event",
      header: "Event",
      sortValue: (e) => e.openedAt,
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-semibold">{e.title}</span>
          <span className="font-mono text-caption-1 text-faded">{e.number}</span>
        </span>
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: (e) => (
        <StatusBadge tone="neutral" size="sm">
          {e.category}
        </StatusBadge>
      ),
    },
    { id: "stage", header: "Stage", sortValue: (e) => stageOf(e, today), cell: (e) => <StageBadge ev={e} size="sm" /> },
    { id: "bids", header: "Bids", sortValue: (e) => responded(e).length / e.invited.length, cell: (e) => <Responders ev={e} /> },
    {
      id: "due",
      header: "Bids due",
      sortValue: (e) => e.closesOn,
      cell: (e) => {
        const days = daysFromToday(e.closesOn)
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span className="tabular">{formatDateShort(e.closesOn)}</span>
            <span className="text-caption-1 text-faded">{e.status === "awarded" ? "Closed" : days >= 0 ? `In ${days} day${days === 1 ? "" : "s"}` : "Closed"}</span>
          </span>
        )
      },
    },
    { id: "spend", header: "Spend a year", align: "right", sortValue: (e) => spendOf(e).baseline, cell: (e) => <span className="tabular">{moneyYear(spendOf(e).baseline)}</span> },
    {
      id: "savings",
      header: "Savings",
      info: "Latest bids against today's rates, at each agency's share of the hours.",
      align: "right",
      sortValue: (e) => spendOf(e).savingsPct,
      cell: (e) => {
        const s = spendOf(e)
        if (!responded(e).length) return <span className="text-faded">—</span>
        return (
          <span className="flex flex-col items-end tabular">
            <span className={cn("font-semibold", s.savings > 0 ? "text-positive-fg" : "text-critical-fg")}>
              {s.savings > 0 ? "−" : "+"}
              {pct(Math.abs(s.savingsPct), 1)}
            </span>
            <span className="text-caption-1 text-faded">{moneyYear(Math.abs(s.savings))} a year</span>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Spend in negotiation" prefix="$" {...compact(totals.baseline)} sub={`A year, across ${live.length} open event${live.length === 1 ? "" : "s"}`} tone="brand" />
        <StatCard
          label="Projected savings"
          info="What the latest bids save against today's rates, at each agency's share of the hours."
          prefix="$"
          {...compact(totals.savings)}
          sub={totals.baseline ? `${pct(totals.savings / totals.baseline, 1)} below today's rates` : undefined}
          tone="positive"
        />
        <StatCard
          label="Bids in"
          value={totals.bids}
          suffix={`of ${totals.invited}`}
          sub={totals.counters ? `${totals.counters} counter${totals.counters === 1 ? "" : "s"} waiting on agencies` : "Nothing waiting on agencies"}
        />
      </div>
      <Surface elevated className="overflow-hidden">
        <DataTable
          rows={events}
          columns={columns}
          getRowId={(e) => e.id}
          onRowClick={(e) => router.push(`/procurement/${e.id}`)}
          rowClassName={(e) => (e.status === "awarded" ? "text-faded" : undefined)}
          initialSort={{ id: "event", dir: "desc" }}
          empty={<EmptyState icon={FileSearch} title="No sourcing events yet" description="Start one to have agencies bid on a market's roles." compact />}
        />
      </Surface>
    </>
  )
}

function Invitations({ events, supplierId }: { events: SourcingEvent[]; supplierId: string }) {
  const router = useRouter()
  const columns: Column<SourcingEvent>[] = [
    {
      id: "event",
      header: "Event",
      sortValue: (e) => e.openedAt,
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-semibold">{e.title}</span>
          <span className="font-mono text-caption-1 text-faded">{e.number}</span>
        </span>
      ),
    },
    { id: "market", header: "Market", cell: (e) => marketName(e) },
    { id: "roles", header: "Roles", align: "right", cell: (e) => <span className="tabular">{e.lines.length}</span> },
    {
      id: "due",
      header: "Bids due",
      sortValue: (e) => e.closesOn,
      cell: (e) => <span className="tabular">{formatDateShort(e.closesOn)}</span>,
    },
    {
      id: "status",
      header: "Your bid",
      cell: (e) => {
        const s = agencyStatus(e, supplierId)
        return (
          <StatusBadge tone={s.tone} size="sm" dot>
            {s.label}
          </StatusBadge>
        )
      },
    },
  ]
  return (
    <Surface elevated className="overflow-hidden">
      <DataTable
        rows={events}
        columns={columns}
        getRowId={(e) => e.id}
        onRowClick={(e) => router.push(`/procurement/${e.id}`)}
        initialSort={{ id: "event", dir: "desc" }}
        empty={<EmptyState icon={FileSearch} title="No invitations yet" description="When Compass invites you to bid, it shows up here." compact />}
      />
    </Surface>
  )
}

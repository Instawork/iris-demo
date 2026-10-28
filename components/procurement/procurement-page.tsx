"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, FileSearch, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { InfoTip } from "@/components/common/info-tip"
import { PageHeader, SectionTitle } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Contracts } from "@/components/procurement/contracts"
import { NewEventDialog } from "@/components/procurement/new-event-dialog"
import { MarketRates } from "@/components/procurement/market-rates"
import { Change, StageBadge, VsMarket, agencyStatus, moneyYear } from "@/components/procurement/sourcing-bits"
import { RatesPage } from "@/components/rates/rates-page"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { daysFromToday, formatDateFull, formatDateShort } from "@/lib/dates"
import { pct } from "@/lib/format"
import { benchmark } from "@/lib/market"
import { latestBid, responded, spendOf } from "@/lib/sourcing"
import type { SourcingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

type Tab = "events" | "rates" | "contracts"

/**
 * Procurement: Compass runs sourcing events with its agencies, and the rate cards they produce sit beside them. An
 * agency sees the events it's invited to and its own rate cards.
 */
export function ProcurementPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const isAgency = ws.kind === "supplier"
  const asked = params.get("tab")
  const [tab, setTab] = useState<Tab>(asked === "rates" ? "rates" : asked === "contracts" && !isAgency ? "contracts" : "events")
  const [creating, setCreating] = useState(false)
  const events = useMemo(
    () => (data.sourcing ?? []).filter((e) => !isAgency || e.invited.includes(ws.supplierId!)).sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [data.sourcing, isAgency, ws.supplierId],
  )

  const change = (next: Tab) => {
    setTab(next)
    router.replace(next === "events" ? "/procurement" : `/procurement?tab=${next}`, { scroll: false })
  }

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Procurement"
        description={isAgency ? "Compass's invitations to bid, and your rate cards." : "Your rates against the market, and the bids that set next year's."}
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
          { value: "events", label: isAgency ? "Invitations" : "Events", count: events.filter((e) => e.status === "open").length },
          { value: "rates", label: isAgency ? "My rate cards" : "Market rates" },
          ...(isAgency ? [] : [{ value: "contracts" as const, label: "Contracts" }]),
        ]}
      />
      {tab === "contracts" ? (
        <Contracts />
      ) : tab === "rates" ? (
        isAgency ? (
          <RatesPage embedded />
        ) : (
          <MarketRates />
        )
      ) : (
        <Events events={events} supplierId={isAgency ? ws.supplierId : undefined} onCreate={() => setCreating(true)} />
      )}
      {!isAgency && <NewEventDialog open={creating} onOpenChange={setCreating} />}
    </>
  )
}

function Events({ events, supplierId, onCreate }: { events: SourcingEvent[]; supplierId?: string; onCreate: () => void }) {
  const open = events.filter((e) => e.status === "open")
  const closed = events.filter((e) => e.status !== "open")
  return (
    <>
      {!supplierId && open.length > 0 && <Summary events={open} />}
      <section className="flex flex-col gap-3">
        <SectionTitle title={supplierId ? "Open invitations" : "Open"} />
        {open.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {open.map((e) => (
              <EventCard key={e.id} ev={e} supplierId={supplierId} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileSearch}
            title={supplierId ? "No open invitations" : "No open events"}
            description={supplierId ? "When Compass invites you to bid, it shows up here." : "Start one to have agencies bid on a market's roles."}
            actions={
              !supplierId && (
                <Button variant="outline" onClick={onCreate}>
                  <Plus className="size-4" /> New event
                </Button>
              )
            }
            compact
          />
        )}
      </section>
      {closed.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Closed" />
          <Surface elevated className="divide-y divide-border overflow-hidden">
            {closed.map((e) => (
              <ClosedRow key={e.id} ev={e} supplierId={supplierId} />
            ))}
          </Surface>
        </section>
      )}
    </>
  )
}

/** What's on the table across every open event, in one strip. */
function Summary({ events }: { events: SourcingEvent[] }) {
  const t = events.reduce(
    (sum, e) => {
      const s = spendOf(e)
      const m = marketSpend(e)
      return { baseline: sum.baseline + s.baseline, savings: sum.savings + s.savings, proposed: sum.proposed + m.proposed, market: sum.market + m.market }
    },
    { baseline: 0, savings: 0, proposed: 0, market: 0 },
  )
  const cells = [
    { label: "Spend being negotiated", value: moneyYear(t.baseline), info: `A year after VA, across ${events.length} open event${events.length === 1 ? "" : "s"}.` },
    {
      label: "Projected savings",
      value: t.savings > 0 ? moneyYear(t.savings) : "—",
      positive: t.savings > 0,
      info: `A year after VA rebates${t.baseline && t.savings > 0 ? `, ${pct(t.savings / t.baseline, 1)} below today` : ""}: the latest bids and terms against today's, at each agency's share of the hours.`,
    },
    {
      label: "Latest bids vs the market",
      value: t.market ? <VsMarket value={t.proposed / t.market - 1} /> : "—",
      info: "Each role's bids against the median of what agencies across that market bill for it, weighted by hours.",
    },
  ]
  return (
    <Surface elevated className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-0.5 px-5 py-4">
          <span className="flex items-center gap-1.5 text-body-3 text-faded">
            {c.label}
            {c.info && <InfoTip>{c.info}</InfoTip>}
          </span>
          <span className={cn("text-[26px] leading-9 font-semibold tracking-[-0.03em] tabular", c.positive && "text-positive-fg")}>{c.value}</span>
        </div>
      ))}
    </Surface>
  )
}

/** The latest bids and the market median over the same hours, for roles with a bid. */
function marketSpend(ev: SourcingEvent) {
  let proposed = 0
  let market = 0
  for (const line of ev.lines) {
    for (const [s, share] of Object.entries(line.share)) {
      const rate = latestBid(ev, s)?.lines[line.id]?.billRate
      if (rate === undefined) continue
      proposed += line.hours * share * rate
      market += line.hours * share * benchmark(ev.cityId, line.positionId).median
    }
  }
  return { proposed, market }
}

function EventCard({ ev, supplierId }: { ev: SourcingEvent; supplierId?: string }) {
  const spend = spendOf(ev, supplierId, !!supplierId)
  const days = daysFromToday(ev.closesOn)
  const mine = supplierId ? agencyStatus(ev, supplierId) : undefined
  const bids = responded(ev).length
  const facts = [
    supplierId
      ? { label: "Your billings", value: `${moneyYear(spend.baseline)} a year` }
      : { label: "Bids in", value: `${bids} of ${ev.invited.length}` },
    { label: days >= 0 ? "Bids due" : "Bids closed", value: days === 0 ? "Today" : formatDateShort(ev.closesOn) },
    ...(supplierId
      ? []
      : [{ label: "Projected savings", value: bids ? (spend.savings > 0 ? `${moneyYear(spend.savings)} a year` : "None yet") : "—", positive: spend.savings > 0 && bids > 0 }]),
  ]
  return (
    <Link
      href={`/procurement/${ev.id}`}
      data-event={ev.id}
      className="group flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-raised outline-none transition-colors duration-100 hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-caption-1 text-faded">{ev.number}</span>
          <span className="text-featured-3 leading-snug font-semibold">{ev.title}</span>
        </div>
        {mine ? (
          <StatusBadge tone={mine.tone} size="sm" dot>
            {mine.label === "Invited" ? "Not bid yet" : mine.label}
          </StatusBadge>
        ) : (
          <StageBadge ev={ev} size="sm" />
        )}
      </div>
      <div className="flex items-end gap-6 border-t border-border/70 pt-4">
        {facts.map((f) => (
          <span key={f.label} className="flex min-w-0 flex-col">
            <span className="text-caption-1 text-faded">{f.label}</span>
            <span className={cn("truncate text-body-3 font-semibold tabular", "positive" in f && f.positive && "text-positive-fg")}>{f.value}</span>
          </span>
        ))}
        <ChevronRight className="ml-auto size-4 shrink-0 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function ClosedRow({ ev, supplierId }: { ev: SourcingEvent; supplierId?: string }) {
  const spend = spendOf(ev, supplierId, !!supplierId)
  const mine = supplierId ? agencyStatus(ev, supplierId) : undefined
  return (
    <Link href={`/procurement/${ev.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover/60">
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="font-mono text-caption-1 text-faded">{ev.number}</span>
        <span className="truncate font-medium">{ev.title}</span>
      </span>
      <span className="hidden flex-col items-end sm:flex">
        <span className="text-caption-1 text-faded">Approved</span>
        <span className="text-body-3 tabular">{ev.awardedAt ? formatDateFull(ev.awardedAt.slice(0, 10)) : "—"}</span>
      </span>
      <span className="flex w-28 flex-col items-end">
        <span className="text-caption-1 text-faded">{supplierId ? "Your bid" : "vs the year before"}</span>
        {mine ? (
          <span className="text-body-3">{mine.label}</span>
        ) : (
          <Change value={spend.baseline ? spend.proposed / spend.baseline - 1 : undefined} />
        )}
      </span>
      <ChevronRight className="size-4 text-subtle" />
    </Link>
  )
}

"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, FileSearch, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader, SectionTitle } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { DollarBar, hundred } from "@/components/procurement/dollar-split"
import { LiveRates } from "@/components/procurement/live-rates"
import { NewEventDialog } from "@/components/procurement/new-event-dialog"
import { Change, StageBadge, agencyStatus, moneyYear } from "@/components/procurement/sourcing-bits"
import { RatesPage } from "@/components/rates/rates-page"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { dateOf, daysFromToday, formatDateFull, formatDateShort } from "@/lib/dates"
import { supplier } from "@/lib/reference"
import { dollarSplit, responded, spendOf } from "@/lib/sourcing"
import type { SourcingEvent } from "@/lib/types"

type Tab = "events" | "rates"

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
  const [tab, setTab] = useState<Tab>(asked === "rates" ? "rates" : "events")
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
        description={isAgency ? "Compass's invitations to bid, and your rate cards." : "Next year's rates, and the rate cards live today."}
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
          { value: "events", label: isAgency ? "Invitations" : "Renewals", count: events.filter((e) => e.status === "open").length },
          { value: "rates", label: isAgency ? "My rate cards" : "Rate cards" },
        ]}
      />
      {tab === "rates" ? (
        isAgency ? (
          <RatesPage embedded />
        ) : (
          <LiveRates />
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
      <section className="flex flex-col gap-3">
        <SectionTitle title={supplierId ? "Open invitations" : "Up for renewal"} />
        {open.length ? (
          supplierId ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {open.map((e) => (
                <EventCard key={e.id} ev={e} supplierId={supplierId} />
              ))}
            </div>
          ) : (
            open.map((e) => <Renewal key={e.id} ev={e} />)
          )
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
            <span className="truncate text-body-3 font-semibold tabular">{f.value}</span>
          </span>
        ))}
        <ChevronRight className="ml-auto size-4 shrink-0 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

/** An open event as Compass sees it, with the agency that gets the most of each dollar to the worker so far. */
function Renewal({ ev }: { ev: SourcingEvent }) {
  const data = useData()
  const days = daysFromToday(ev.closesOn)
  const best = responded(ev)
    .map((s) => ({ s, split: dollarSplit(ev, data.rateCards, s) }))
    .sort((a, b) => b.split.worker - a.split.worker)[0]
  return (
    <Link
      href={`/procurement/${ev.id}`}
      data-event={ev.id}
      className="group flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-raised outline-none transition-colors duration-100 hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-caption-1 text-faded">{ev.number}</span>
          <span className="flex items-center gap-2.5 text-featured-3 leading-snug font-semibold">
            {ev.title}
            <StageBadge ev={ev} size="sm" />
          </span>
        </span>
        <span className="flex items-center gap-6 text-body-3">
          {[
            { label: "Agencies", value: ev.invited.length },
            { label: "Bids in", value: `${responded(ev).length} of ${ev.invited.length}` },
            { label: days >= 0 ? "Bids due" : "Bids closed", value: days === 0 ? "Today" : formatDateShort(ev.closesOn) },
          ].map((f) => (
            <span key={f.label} className="flex flex-col">
              <span className="text-caption-1 text-faded">{f.label}</span>
              <span className="font-semibold tabular">{f.value}</span>
            </span>
          ))}
          <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
        </span>
      </span>
      {best && (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-4">
          <span className="flex items-center gap-2.5">
            <SupplierLogo supplierId={best.s} size="sm" />
            <span className="text-body-3">
              <span className="font-semibold">{supplier(best.s).shortName}</span> is the best value so far:{" "}
              <span className="font-semibold text-positive-fg">{hundred(best.split).worker}</span> of every $100 to the worker, {hundred(best.split).back} back to you
            </span>
          </span>
          <DollarBar split={best.split} className="ml-auto h-2.5 w-64" />
        </span>
      )}
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
        <span className="text-body-3 tabular">{ev.awardedAt ? formatDateFull(dateOf(ev.awardedAt)) : "—"}</span>
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

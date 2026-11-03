"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, FileSearch, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { PageHeader, SectionTitle } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { EventPage } from "@/components/procurement/event-page"
import { LiveRates } from "@/components/procurement/live-rates"
import { NewEventDialog } from "@/components/procurement/new-event-dialog"
import { Change, StageBadge, agencyStatus, moneyYear } from "@/components/procurement/sourcing-bits"
import { RatesPage } from "@/components/rates/rates-page"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { dateOf, daysFromToday, formatDateFull, formatDateShort } from "@/lib/dates"
import { responded, spendOf } from "@/lib/sourcing"
import type { SourcingEvent } from "@/lib/types"

type Tab = "events" | "rates"

/**
 * Procurement: Compass lands on its current renewal, with the rate cards live today a tab away. An agency sees the
 * events it's invited to and its own rate cards.
 */
export function ProcurementPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const isAgency = ws.kind === "supplier"
  const tab: Tab = params.get("tab") === "rates" ? "rates" : "events"
  const [creating, setCreating] = useState(false)
  const events = useMemo(
    () => (data.sourcing ?? []).filter((e) => !isAgency || e.invited.includes(ws.supplierId!)).sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [data.sourcing, isAgency, ws.supplierId],
  )
  const [current, ...past] = events

  const change = (next: Tab) => router.replace(next === "events" ? "/procurement" : `/procurement?tab=${next}`, { scroll: false })

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Procurement"
        description={isAgency ? "Compass's invitations to bid, and your rate cards." : "Next year's rates, and the rate cards live today."}
        actions={
          !isAgency &&
          tab === "events" && (
            <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => setCreating(true)} data-tour="new-event">
              <Plus className="size-4" /> New event
            </Button>
          )
        }
      />
      <PillTabs
        value={tab}
        onChange={change}
        items={[
          isAgency
            ? { value: "events", label: "Invitations", count: events.filter((e) => e.status === "open").length }
            : { value: "events", label: current ? current.title.replace(/ rate /, " ") : "Renewals" },
          { value: "rates", label: isAgency ? "My rate cards" : "Rate cards" },
        ]}
      />
      {tab === "rates" ? (
        isAgency ? (
          <RatesPage embedded />
        ) : (
          <LiveRates />
        )
      ) : isAgency ? (
        <Invitations events={events} supplierId={ws.supplierId!} />
      ) : current ? (
        <>
          <EventPage id={current.id} embedded />
          {past.length > 0 && <Past events={past} title="Past renewals" />}
        </>
      ) : (
        <EmptyState
          icon={FileSearch}
          title="No renewals yet"
          description="Start one to have agencies bid on a market's roles."
          actions={
            <Button variant="outline" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New event
            </Button>
          }
          compact
        />
      )}
      {!isAgency && <NewEventDialog open={creating} onOpenChange={setCreating} />}
    </>
  )
}

function Invitations({ events, supplierId }: { events: SourcingEvent[]; supplierId: string }) {
  const open = events.filter((e) => e.status === "open")
  const closed = events.filter((e) => e.status !== "open")
  return (
    <>
      <section className="flex flex-col gap-3">
        <SectionTitle title="Open invitations" />
        {open.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {open.map((e) => (
              <EventCard key={e.id} ev={e} supplierId={supplierId} />
            ))}
          </div>
        ) : (
          <EmptyState icon={FileSearch} title="No open invitations" description="When Compass invites you to bid, it shows up here." compact />
        )}
      </section>
      {closed.length > 0 && <Past events={closed} title="Closed" supplierId={supplierId} />}
    </>
  )
}

function Past({ events, title, supplierId }: { events: SourcingEvent[]; title: string; supplierId?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title={title} />
      <Surface elevated className="divide-y divide-border overflow-hidden">
        {events.map((e) => (
          <ClosedRow key={e.id} ev={e} supplierId={supplierId} />
        ))}
      </Surface>
    </section>
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

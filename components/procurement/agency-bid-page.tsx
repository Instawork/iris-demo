"use client"

import Link from "next/link"
import { ArrowLeft, CircleCheck, FileSearch } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { Tip } from "@/components/common/info-tip"
import { CitySelect } from "@/components/common/city-select"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { termsLine } from "@/components/procurement/event-page"
import { agencyStatus, vsMarketLabel } from "@/components/procurement/sourcing-bits"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatTimestamp } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { marketPay } from "@/lib/market"
import { city, position, supplier } from "@/lib/reference"
import { agencyValue, bestMarkup, latestBid, marketsOf, offeredTerms, openCounters, pct, responded } from "@/lib/sourcing"
import { useStore } from "@/lib/store"
import type { SourcingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * One agency's bid on a renewal, full screen: its markup, its pay against the market and its VA, then its rate card a
 * market at a time. The markup is the one number to counter. Iris counters the whole event at once; this is for the
 * agencies Compass wants to push by hand.
 */
export function AgencyBidPage({ id, supplierId }: { id: string; supplierId: string }) {
  const data = useData()
  const { ws } = useWorkspace()
  const ev = (data.sourcing ?? []).find((e) => e.id === id)
  const markets = ev ? marketsOf(ev, supplierId) : []
  const [market, setMarket] = useState(markets[0] ?? "")
  const [query, setQuery] = useState("")
  if (!ev || ws.kind !== "compass" || !ev.invited.includes(supplierId)) {
    return (
      <div className="pt-10">
        <EmptyState
          icon={FileSearch}
          title="Agency not found"
          description="It may not be on this event."
          actions={
            <Button asChild variant="outline">
              <Link href="/procurement">Back to Procurement</Link>
            </Button>
          }
        />
      </div>
    )
  }
  const s = supplier(supplierId)
  const bid = latestBid(ev, supplierId)
  const status = agencyStatus(ev, supplierId)
  const value = agencyValue(ev, data.rateCards, supplierId)
  const q = query.trim().toLowerCase()
  const lines = ev.lines.filter((l) => l.cityId === market && bid?.lines[l.id] && position(l.positionId).name.toLowerCase().includes(q))
  const inMarket = ev.lines.filter((l) => l.cityId === market && bid?.lines[l.id]).length

  return (
    <>
      <div className="flex flex-col gap-3 pt-4">
        <Link href="/procurement" className="flex w-fit items-center gap-1.5 text-body-3 text-faded transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> {ev.title}
        </Link>
        <header className="flex flex-wrap items-center gap-4">
          <SupplierLogo supplierId={supplierId} size="lg" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <h1 className="flex flex-wrap items-center gap-3 text-featured-1 font-semibold">
              {s.name}
              <StatusBadge tone={status.tone} size="sm" dot>
                {status.label === "Invited" ? "No bid yet" : status.label}
              </StatusBadge>
            </h1>
            <span className="text-body-3 text-faded">
              {termsLine(offeredTerms(ev, supplierId))}
              {bid ? ` · round ${bid.round}, sent ${formatTimestamp(bid.at)}` : ""}
            </span>
          </span>
        </header>
      </div>

      <Surface elevated className="grid grid-cols-3 gap-6 px-5 py-5" data-tour="agency-terms">
        <Stat label="Markup" note="On every role, in every market">
          <span className="flex flex-wrap items-center gap-3">
            {pct(Math.round(value.markupPct))}
            {bid && <CounterMarkup ev={ev} supplierId={supplierId} />}
          </span>
        </Stat>
        <Stat label="Worker pay vs market" note="Averaged over every role, by the hours you buy">
          {vsMarketLabel(value.payVsMarket)}
        </Stat>
        <Stat label="VA" note="Back at year end">
          {pct(value.vaPct)}
        </Stat>
      </Surface>

      <Surface elevated className="overflow-hidden" data-tour="agency-rate-card">
        <SurfaceHeader
          title="Rate card"
          description={bid ? plural(inMarket, "role") : `No rates until ${s.shortName} bids`}
          actions={
            <span className="flex items-center gap-2">
              {markets.length > 1 && (
                <CitySelect value={market} onChange={setMarket} items={markets.map((c) => ({ value: c, label: `${city(c).name}, ${city(c).state}` }))} />
              )}
              <SearchInput value={query} onChange={setQuery} placeholder="Search roles" className="w-56" />
            </span>
          }
        />
        <div className={cn(ROW, "border-t border-border/70 py-2 text-caption-1 text-faded")}>
          <span>Role</span>
          <span className="text-right">Worker pay</span>
          <span className="text-right">Market pay</span>
          <span className="text-right">vs market</span>
          <span className="text-right">Rate</span>
        </div>
        <ol className="flex flex-col">
          {lines.map((l) => {
            const line = bid!.lines[l.id]
            const market = marketPay(l.cityId, l.positionId)
            return (
              <li key={l.id} className={cn(ROW, "border-t border-border/70 py-3 text-body-3")} data-tour="bid-row" data-supplier={supplierId} data-position={l.positionId}>
                <span className="truncate font-medium">{position(l.positionId).name}</span>
                <span className="text-right tabular">{money(line.proRate)}</span>
                <span className="text-right text-faded tabular">{money(market)}</span>
                <span className="text-right text-faded">{vsMarketLabel(line.proRate / market - 1)}</span>
                <span className="text-right text-body-2 font-semibold tabular">{money(line.billRate)}</span>
              </li>
            )
          })}
        </ol>
        {bid && !lines.length && <p className="border-t border-border/70 px-5 py-4 text-body-3 text-faded">No roles match.</p>}
      </Surface>
    </>
  )
}

const ROW = "grid grid-cols-[minmax(180px,1fr)_110px_110px_150px_110px] items-center gap-4 px-5"

function Stat({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption-1 text-faded">{label}</span>
      <span className="text-[28px] leading-9 font-semibold tracking-[-0.03em] tabular">{children}</span>
      <span className="text-caption-1 text-faded">{note}</span>
    </div>
  )
}

/** Compass asks the agency for a lower markup, on every role at once. */
function CounterMarkup({ ev, supplierId }: { ev: SourcingEvent; supplierId: string }) {
  const counter = useStore((s) => s.counterBid)
  const bid = latestBid(ev, supplierId)!
  const asked = openCounters(ev, supplierId).at(-1)
  const locked = !!ev.approved[supplierId] || ev.status === "awarded"
  const [ask, setAsk] = useState<string | null>(null)
  const askN = Number(ask)
  const valid = ask !== "" && askN >= 0 && askN < bid.markupPct
  const suggest = () => {
    const best = responded(ev).length > 1 ? bestMarkup(ev) : 0
    return Math.max(best, Math.ceil(bid.markupPct) - 3) < bid.markupPct ? Math.max(best, Math.ceil(bid.markupPct) - 3) : Math.max(0, Math.ceil(bid.markupPct) - 1)
  }
  const send = () =>
    void counter(ev.id, supplierId, askN).then((ok) => {
      if (!ok) return
      setAsk(null)
      toast.success(`Counter sent to ${supplier(supplierId).shortName}`, { description: `A ${pct(askN)} markup on every role` })
    })
  if (locked)
    return (
      <span className="flex items-center gap-1 text-caption-1 font-medium text-positive-fg">
        <CircleCheck className="size-3.5" /> Approved
      </span>
    )
  if (asked)
    return (
      <Tip content={`Waiting on ${supplier(supplierId).contactName.split(" ")[0]}`}>
        <span className="text-caption-1 font-medium tracking-normal text-warning-fg">Asked {pct(asked.ask!)}</span>
      </Tip>
    )
  if (ask === null)
    return (
      <Button variant="outline" size="sm" data-tour="counter" onClick={() => setAsk(String(suggest()))}>
        Counter markup
      </Button>
    )
  return (
    <form
      className="flex items-center gap-2 text-body-3 font-normal tracking-normal"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) send()
      }}
    >
      <span className="relative w-20">
        <input
          inputMode="decimal"
          aria-label="Counter at"
          value={ask}
          autoFocus
          onChange={(e) => setAsk(e.target.value.replace(/[^\d.]/g, ""))}
          className="h-8 w-full rounded-lg border border-input bg-card pr-6 pl-2.5 text-right text-body-3 font-semibold tabular outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
        />
        <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-faded">%</span>
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAsk(null)}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={!valid} data-tour="send-counter">
        Send
      </Button>
    </form>
  )
}

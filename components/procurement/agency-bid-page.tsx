"use client"

import Link from "next/link"
import { ArrowLeft, FileSearch } from "lucide-react"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatTimestamp } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { marketPay } from "@/lib/market"
import { city, position, supplier } from "@/lib/reference"
import { agencyValue, bestMarkup, decided, latestBid, marketsOf, offeredTerms, openCounters, pct, responded } from "@/lib/sourcing"
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
                {status.label}
              </StatusBadge>
            </h1>
            <span className="text-body-3 text-faded">
              {termsLine(offeredTerms(ev, supplierId))}
              {bid ? ` · sent ${formatTimestamp(bid.at)}` : ""}
            </span>
          </span>
          {bid && ev.status === "open" && !decided(ev, supplierId) && (
            <span className="ml-auto flex items-center gap-2">
              <RejectBid ev={ev} supplierId={supplierId} />
              <CounterBid ev={ev} supplierId={supplierId} />
            </span>
          )}
        </header>
      </div>

      <Surface elevated className="grid grid-cols-3 gap-6 px-5 py-5" data-tour="agency-terms">
        <Stat label="Markup" note="On every role, in every market">
          {pct(Math.round(value.markupPct))}
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

/** Compass counters the agency's bid: a lower markup on every role, more VA, or both, in one ask. */
function CounterBid({ ev, supplierId }: { ev: SourcingEvent; supplierId: string }) {
  const counter = useStore((s) => s.counterBid)
  const bid = latestBid(ev, supplierId)!
  const va = offeredTerms(ev, supplierId).vaPct
  const asked = openCounters(ev, supplierId).at(-1)
  const [open, setOpen] = useState(false)
  const [markup, setMarkup] = useState("")
  const [vaAsk, setVaAsk] = useState("")
  const markupN = markup === "" ? undefined : Number(markup)
  const vaN = vaAsk === "" ? undefined : Number(vaAsk)
  const markupOk = markupN === undefined || (markupN >= 0 && markupN < bid.markupPct)
  const vaOk = vaN === undefined || (vaN > va && vaN <= 50)
  const changed = (markupN !== undefined && markupN !== bid.markupPct) || (vaN !== undefined && vaN !== va)
  const valid = markupOk && vaOk && changed
  const start = () => {
    const best = responded(ev).length > 1 ? bestMarkup(ev) : 0
    const target = Math.max(best, Math.ceil(bid.markupPct) - 3)
    setMarkup(String(target < bid.markupPct ? target : Math.max(0, Math.ceil(bid.markupPct) - 1)))
    setVaAsk(String(va + 2))
  }
  const send = () =>
    void counter(ev.id, supplierId, { markupPct: markupN !== bid.markupPct ? markupN : undefined, vaPct: vaN !== va ? vaN : undefined }).then((ok) => {
      if (!ok) return
      setOpen(false)
      toast.success(`Counter sent to ${supplier(supplierId).shortName}`)
    })
  if (asked)
    return (
      <Tip content={`Waiting on ${supplier(supplierId).contactName.split(" ")[0]}`}>
        <span className="text-body-3 font-medium text-warning-fg">
          Asked {[asked.ask !== undefined && `${pct(asked.ask)} markup`, asked.askVa !== undefined && `${pct(asked.askVa)} VA`].filter(Boolean).join(" · ")}
        </span>
      </Tip>
    )
  return (
    <Popover open={open} onOpenChange={(o) => (o && start(), setOpen(o))}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 rounded-lg text-body-3" data-tour="counter">
          Counter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3 p-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) send()
          }}
        >
          <span className="text-body-3 font-semibold">Counter {supplier(supplierId).shortName}</span>
          <AskField label="Markup" now={bid.markupPct} value={markup} onChange={setMarkup} invalid={!markupOk} autoFocus />
          <AskField label="VA" now={va} value={vaAsk} onChange={setVaAsk} invalid={!vaOk} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid} data-tour="send-counter">
              Send counter
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** Compass turns the agency's bid down. It's out of this renewal, and its rate cards stay as they are. */
function RejectBid({ ev, supplierId }: { ev: SourcingEvent; supplierId: string }) {
  const reject = useStore((s) => s.rejectBid)
  const [open, setOpen] = useState(false)
  const name = supplier(supplierId).shortName
  const go = () =>
    void reject(ev.id, supplierId).then((ok) => {
      if (!ok) return
      setOpen(false)
      toast.success(`${name}'s bid is rejected`)
    })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-9 rounded-lg text-body-3 text-faded hover:text-critical-fg">
          Reject
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-4">
        <span className="text-body-3 font-semibold">Reject {name}&apos;s bid?</span>
        <span className="text-body-3 text-faded">Their rate cards stay as they are today.</span>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={go}>
            Reject
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AskField({ label, now, value, onChange, invalid, autoFocus }: { label: string; now: number; value: string; onChange: (v: string) => void; invalid: boolean; autoFocus?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 text-body-3">
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-caption-1 text-faded">Now {pct(now)}</span>
      </span>
      <span className="relative w-24">
        <input
          inputMode="decimal"
          aria-label={`${label} ask`}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          className={cn(
            "h-9 w-full rounded-lg border border-input bg-card pr-7 pl-2.5 text-right text-body-3 font-semibold tabular outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15",
            invalid && "border-critical-border text-critical-fg",
          )}
        />
        <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-faded">%</span>
      </span>
    </label>
  )
}

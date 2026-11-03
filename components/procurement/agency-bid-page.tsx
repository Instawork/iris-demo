"use client"

import Link from "next/link"
import { ArrowLeft, CircleCheck, FileSearch } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { DollarBar, PARTS, SPLIT_INFO, hundred } from "@/components/procurement/dollar-split"
import { termsLine } from "@/components/procurement/event-page"
import { agencyStatus } from "@/components/procurement/sourcing-bits"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatTimestamp } from "@/lib/dates"
import { money, plural, round2 } from "@/lib/format"
import { benchmark, type Benchmark } from "@/lib/market"
import { city, position, supplier } from "@/lib/reference"
import { bestOn, dollarSplit, latestBid, marketsOf, netOf, offeredTerms, openCounters, responded } from "@/lib/sourcing"
import { useStore } from "@/lib/store"
import type { SourcingEvent, SourcingLine } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * One agency's bid on a renewal, full screen: where its dollar goes, then its rate card a market at a time, every role
 * counterable in place. Iris counters the whole event at once; this is for the ones Compass wants to push by hand.
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
  const split = dollarSplit(ev, data.rateCards, supplierId)
  const q = query.trim().toLowerCase()
  const lines = ev.lines.filter((l) => l.cityId === market && bid?.lines[l.id] && position(l.positionId).name.toLowerCase().includes(q))
  const inMarket = ev.lines.filter((l) => l.cityId === market && bid?.lines[l.id]).length
  const asked = openCounters(ev, supplierId).length

  return (
    <>
      <div className="flex flex-col gap-3 pt-4">
        <Link href={`/procurement/${ev.id}`} className="flex w-fit items-center gap-1.5 text-body-3 text-faded transition-colors hover:text-foreground">
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

      <Surface elevated className="flex flex-col gap-4 px-5 py-5" data-tour="agency-dollar">
        <span className="flex items-center gap-1.5 text-body-3 font-semibold">
          Of every $100 you pay {s.shortName}
          <InfoTip>{SPLIT_INFO}</InfoTip>
        </span>
        <DollarBar split={split} className="h-4" />
        <dl className="grid grid-cols-3 gap-4">
          {PARTS.map((p) => (
            <div key={p.key} className="flex flex-col gap-0.5">
              <dt className="flex items-center gap-1.5 text-caption-1 text-faded">
                <span className={cn("size-2.5 rounded-full", p.swatch)} />
                {p.label}
              </dt>
              <dd className={cn("text-[28px] leading-9 font-semibold tracking-[-0.03em] tabular", p.key === "worker" && "text-positive-fg")}>{hundred(split)[p.key]}</dd>
              <dd className="text-caption-1 text-faded">
                {p.key === "worker" ? "Their pay" : p.key === "agency" ? `${Math.round(split.markup * 10) / 10}% average markup, less VA` : `${split.vaPct}% VA at year end`}
              </dd>
            </div>
          ))}
        </dl>
      </Surface>

      <Surface elevated className="overflow-hidden" data-tour="agency-rate-card">
        <SurfaceHeader
          title="Rate card"
          description={bid ? `${plural(inMarket, "role")}${asked ? ` · ${plural(asked, "counter")} waiting on ${s.shortName}` : ""}` : `Nothing to counter until ${s.shortName} bids`}
          actions={<SearchInput value={query} onChange={setQuery} placeholder="Search roles" className="w-56" />}
        />
        {markets.length > 1 && (
          <div className="px-5 pt-3">
            <PillTabs size="sm" value={market} onChange={setMarket} items={markets.map((c) => ({ value: c, label: city(c).name }))} />
          </div>
        )}
        <div className="mt-3 grid grid-cols-[minmax(180px,1fr)_100px_90px_120px_150px] gap-4 border-t border-border/70 px-5 py-2 text-caption-1 text-faded">
          <span>Role</span>
          <span className="text-right">Worker pay</span>
          <span className="text-right">Markup</span>
          <span className="text-right">Rate</span>
          <span />
        </div>
        <ol className="flex flex-col">
          {lines.map((l) => (
            <BidRow key={l.id} ev={ev} line={l} supplierId={supplierId} market={benchmark(l.cityId, l.positionId)} />
          ))}
        </ol>
        {bid && !lines.length && <p className="border-t border-border/70 px-5 py-4 text-body-3 text-faded">No roles match.</p>}
      </Surface>
    </>
  )
}

/** One role on the agency's bid, with a counter right in the row. */
function BidRow({ ev, line, supplierId, market }: { ev: SourcingEvent; line: SourcingLine; supplierId: string; market: Benchmark }) {
  const counter = useStore((s) => s.counterBid)
  const bid = latestBid(ev, supplierId)!.lines[line.id]
  const asked = openCounters(ev, supplierId).find((m) => m.lineId === line.id)
  const field = bestOn(ev, line.id)
  const va = offeredTerms(ev, supplierId).vaPct
  const net = netOf(ev, supplierId, bid.billRate)
  const locked = !!ev.approved[supplierId] || ev.status === "awarded"
  const best = field?.supplierId === supplierId && responded(ev).length > 1
  const high = bid.billRate > market.median
  const [ask, setAsk] = useState<string | null>(null)
  const askN = Number(ask)
  const valid = askN > 0 && askN < bid.billRate
  const tie = field && field.supplierId !== supplierId && field.net < net ? round2(field.net / (1 - va / 100)) : undefined
  const suggest = () => round2(tie && tie < bid.billRate ? tie : Math.min(bid.billRate * 0.97, market.median))
  const send = () =>
    void counter(ev.id, supplierId, line.id, askN).then((ok) => {
      if (!ok) return
      setAsk(null)
      toast.success(`Counter sent to ${supplier(supplierId).shortName}`, { description: `${position(line.positionId).name} at ${money(askN)}/hr` })
    })
  return (
    <li className="flex flex-col border-t border-border/70" data-tour="bid-row" data-supplier={supplierId} data-position={line.positionId}>
      <div className="grid grid-cols-[minmax(180px,1fr)_100px_90px_120px_150px] items-center gap-4 px-5 py-3 text-body-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{position(line.positionId).name}</span>
          {best ? (
            <StatusBadge tone="positive" size="sm">
              Best
            </StatusBadge>
          ) : high ? (
            <Tip content={`The market is ${money(market.median)}`}>
              <span>
                <StatusBadge tone="warning" size="sm">
                  Above market
                </StatusBadge>
              </span>
            </Tip>
          ) : null}
        </span>
        <span className="text-right tabular">{money(bid.proRate)}</span>
        <span className="text-right text-faded tabular">{bid.markupPct}%</span>
        <span className="text-right text-body-2 font-semibold tabular">{money(bid.billRate)}</span>
        <span className="flex justify-end">
          {locked ? (
            <span className="flex items-center gap-1 text-caption-1 font-medium text-positive-fg">
              <CircleCheck className="size-3.5" /> Approved
            </span>
          ) : asked ? (
            <Tip content={`Waiting on ${supplier(supplierId).contactName.split(" ")[0]}`}>
              <span className="text-caption-1 font-medium text-warning-fg">Asked {money(asked.ask!)}</span>
            </Tip>
          ) : ask === null ? (
            <Button variant="outline" size="sm" data-tour="counter" onClick={() => setAsk(suggest().toFixed(2))}>
              Counter
            </Button>
          ) : null}
        </span>
      </div>
      {ask !== null && !asked && !locked && (
        <form
          className="flex items-center gap-2 border-t border-border/70 bg-page-faded/60 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) send()
          }}
        >
          <span className="text-caption-1 font-medium text-faded">Counter at</span>
          <span className="relative w-28">
            <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-body-3 text-faded">$</span>
            <input
              inputMode="decimal"
              aria-label="Counter at"
              value={ask}
              autoFocus
              onChange={(e) => setAsk(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-8 w-full rounded-lg border border-input bg-card pr-2 pl-6 text-body-3 font-semibold tabular outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            />
          </span>
          <span className="flex-1 truncate text-caption-1 text-faded">The market is {money(market.median)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAsk(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid} data-tour="send-counter">
            Send
          </Button>
        </form>
      )}
    </li>
  )
}

"use client"

import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { SearchInput } from "@/components/common/filters"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { useData } from "@/hooks/use-app"
import { formatDateShort } from "@/lib/dates"
import { money, plural } from "@/lib/format"
import { CITIES, POSITIONS, supplier } from "@/lib/reference"
import type { RateCard } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The live rate cards, nested so they stay readable at any scale: one row per market, its positions inside it, and each
 * agency's rate inside a position. Every level says how many agencies cover what, and flags a position no agency
 * carries in a market, or only one does.
 */

type PositionRow = { positionId: string; name: string; cards: RateCard[] }
type MarketRow = { cityId: string; name: string; positions: PositionRow[]; agencies: string[]; gaps: number; thin: number; low?: number; high?: number }

const byBill = (a: RateCard, b: RateCard) => a.billRate - b.billRate

export function LiveRates() {
  const data = useData()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setOpen((o) => (o.has(key) ? new Set([...o].filter((k) => k !== key)) : new Set([...o, key])))

  const markets = useMemo<MarketRow[]>(() => {
    const live = data.rateCards.filter((c) => c.status === "active")
    return CITIES.filter((c) => live.some((x) => x.cityId === c.id))
      .map((c) => {
        const here = live.filter((x) => x.cityId === c.id)
        const positions = POSITIONS.map((p) => ({ positionId: p.id, name: p.name, cards: here.filter((x) => x.positionId === p.id).sort(byBill) }))
        const bills = here.map((x) => x.billRate)
        return {
          cityId: c.id,
          name: `${c.name}, ${c.state}`,
          positions,
          agencies: [...new Set(here.map((x) => x.supplierId))].sort(),
          gaps: positions.filter((p) => !p.cards.length).length,
          thin: positions.filter((p) => p.cards.length === 1).length,
          low: bills.length ? Math.min(...bills) : undefined,
          high: bills.length ? Math.max(...bills) : undefined,
        }
      })
      .sort((a, b) => b.gaps - a.gaps || b.thin - a.thin || a.name.localeCompare(b.name))
  }, [data.rateCards])

  const q = query.trim().toLowerCase()
  const matches = (m: MarketRow) => m.positions.filter((p) => !q || p.name.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
  const shown = markets.filter((m) => matches(m).length)
  const agencies = new Set(markets.flatMap((m) => m.agencies)).size
  const gaps = markets.reduce((n, m) => n + m.gaps, 0)
  const thin = markets.reduce((n, m) => n + m.thin, 0)

  return (
    <Surface elevated className="overflow-hidden" data-tour="live-rates">
      <SurfaceHeader
        title="Live rate cards"
        description={`${plural(agencies, "agency", "agencies")} · ${plural(POSITIONS.length, "position")} · ${plural(markets.length, "market")}`}
        actions={<SearchInput value={query} onChange={setQuery} placeholder="Search positions or markets" className="w-64" />}
      />
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2 text-caption-1">
        <span className={gaps ? "font-medium text-critical-fg" : "text-positive-fg"}>{gaps ? `${plural(gaps, "position")} with no agency in a market` : "Every position is covered in every market"}</span>
        {thin > 0 && <span className="font-medium text-warning-fg">{plural(thin, "position")} with only one agency</span>}
      </p>
      <div className="mt-3 grid grid-cols-[minmax(200px,1.4fr)_120px_minmax(140px,1fr)_130px_minmax(150px,1fr)_16px] gap-4 border-t border-border/70 px-5 py-2 text-caption-1 text-faded">
        <span>Market</span>
        <span>Positions</span>
        <span>Agencies</span>
        <span className="text-right">Bill rates</span>
        <span />
        <span />
      </div>
      <ul className="flex flex-col">
        {shown.map((m) => {
          const expanded = open.has(m.cityId) || !!q
          return (
            <li key={m.cityId} className="border-t border-border/70" data-market={m.cityId}>
              <button
                type="button"
                onClick={() => toggle(m.cityId)}
                aria-expanded={expanded}
                className="group grid w-full grid-cols-[minmax(200px,1.4fr)_120px_minmax(140px,1fr)_130px_minmax(150px,1fr)_16px] items-center gap-4 px-5 py-3.5 text-left text-body-3 transition-colors hover:bg-hover/50"
              >
                <span className="text-body-2 font-semibold">{m.name}</span>
                <span className="tabular">
                  <span className="font-semibold">{POSITIONS.length - m.gaps}</span> <span className="text-faded">of {POSITIONS.length}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Logos ids={m.agencies} />
                  <span className="text-faded">{m.agencies.length}</span>
                </span>
                <span className="text-right tabular">{m.low !== undefined && m.high !== undefined ? `${money(m.low)}–${money(m.high)}` : "—"}</span>
                <span className="flex flex-wrap gap-1.5">
                  {m.gaps > 0 && (
                    <StatusBadge tone="critical" size="sm">
                      {plural(m.gaps, "gap")}
                    </StatusBadge>
                  )}
                  {m.thin > 0 && (
                    <StatusBadge tone="warning" size="sm">
                      {m.thin} with one agency
                    </StatusBadge>
                  )}
                  {!m.gaps && !m.thin && (
                    <StatusBadge tone="positive" size="sm">
                      Fully covered
                    </StatusBadge>
                  )}
                </span>
                <ChevronRight className={cn("size-4 text-subtle transition-transform duration-150", expanded && "rotate-90")} />
              </button>
              {expanded && <Positions market={m} rows={matches(m)} open={open} toggle={toggle} />}
            </li>
          )
        })}
      </ul>
      {!shown.length && <p className="border-t border-border/70 px-5 py-4 text-body-3 text-faded">Nothing matches.</p>}
    </Surface>
  )
}

function Positions({ market, rows, open, toggle }: { market: MarketRow; rows: PositionRow[]; open: Set<string>; toggle: (key: string) => void }) {
  return (
    <div className="mx-5 mb-4 overflow-hidden rounded-lg border border-border bg-page-faded/40">
      <div className="grid grid-cols-[minmax(180px,1fr)_minmax(140px,1fr)_150px_120px_16px] gap-4 px-4 py-2 text-caption-1 text-faded">
        <span>Position</span>
        <span>Agencies</span>
        <span className="text-right">Lowest bill rate</span>
        <span className="text-right">Highest</span>
        <span />
      </div>
      <ul className="flex flex-col">
        {rows.map((p) => {
          const key = `${market.cityId}:${p.positionId}`
          const expanded = open.has(key)
          const low = p.cards[0]
          const high = p.cards.at(-1)
          return (
            <li key={p.positionId} className="border-t border-border/70" data-position={p.positionId}>
              <button
                type="button"
                disabled={!p.cards.length}
                onClick={() => toggle(key)}
                aria-expanded={expanded}
                className="grid w-full grid-cols-[minmax(180px,1fr)_minmax(140px,1fr)_150px_120px_16px] items-center gap-4 px-4 py-2.5 text-left text-body-3 transition-colors enabled:hover:bg-hover/50"
              >
                <span className="font-medium">{p.name}</span>
                <span className="flex items-center gap-2">
                  {p.cards.length ? (
                    <>
                      <Logos ids={p.cards.map((c) => c.supplierId)} />
                      {p.cards.length === 1 ? (
                        <StatusBadge tone="warning" size="sm">
                          Only {supplier(p.cards[0].supplierId).shortName}
                        </StatusBadge>
                      ) : (
                        <span className="text-faded">{p.cards.length}</span>
                      )}
                    </>
                  ) : (
                    <StatusBadge tone="critical" size="sm">
                      No agency
                    </StatusBadge>
                  )}
                </span>
                <span className="text-right tabular">
                  {low ? (
                    <>
                      <span className="font-semibold">{money(low.billRate)}</span> <span className="text-caption-1 text-faded">{supplier(low.supplierId).shortName}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="text-right text-faded tabular">{high && high !== low ? money(high.billRate) : "—"}</span>
                {p.cards.length ? <ChevronRight className={cn("size-4 text-subtle transition-transform duration-150", expanded && "rotate-90")} /> : <span />}
              </button>
              {expanded && <Agencies cards={p.cards} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Agencies({ cards }: { cards: RateCard[] }) {
  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-md border border-border bg-card">
      <div className="grid grid-cols-[minmax(160px,1fr)_100px_80px_100px_110px] gap-4 px-3 py-1.5 text-caption-1 text-faded">
        <span>Agency</span>
        <span className="text-right">Worker pay</span>
        <span className="text-right">Markup</span>
        <span className="text-right">Bill rate</span>
        <span className="text-right">Since</span>
      </div>
      {cards.map((c) => (
        <div key={c.id} className="grid grid-cols-[minmax(160px,1fr)_100px_80px_100px_110px] items-center gap-4 border-t border-border/70 px-3 py-2 text-body-3">
          <span className="flex items-center gap-2">
            <SupplierLogo supplierId={c.supplierId} size="sm" />
            <span className="truncate font-medium">{supplier(c.supplierId).name}</span>
          </span>
          <span className="text-right tabular">{money(c.proRate)}</span>
          <span className="text-right text-faded tabular">{Math.round(c.markupPct)}%</span>
          <span className="text-right font-semibold tabular">{money(c.billRate)}</span>
          <span className="text-right text-caption-1 text-faded">{formatDateShort(c.effectiveFrom)}</span>
        </div>
      ))}
    </div>
  )
}

function Logos({ ids }: { ids: string[] }) {
  return (
    <span className="flex gap-1">
      {ids.map((s) => (
        <span key={s} title={supplier(s).name}>
          <SupplierLogo supplierId={s} size="sm" />
        </span>
      ))}
    </span>
  )
}

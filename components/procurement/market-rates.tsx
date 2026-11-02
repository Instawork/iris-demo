"use client"

import Link from "next/link"
import { ChevronRight, Download, MapPin } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { Surface } from "@/components/common/surface"
import { BenchmarkBar, BenchmarkLegend, VsMarket } from "@/components/procurement/sourcing-bits"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useData } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { money } from "@/lib/format"
import { benchmark, vsMarket, type Benchmark } from "@/lib/market"
import { CITIES, POSITIONS, city, position, requirementLabel, supplier } from "@/lib/reference"
import { buildLines, estimatedHours } from "@/lib/sourcing"
import type { RateCard } from "@/lib/types"

interface Row {
  positionId: string
  market: Benchmark
  /** What Compass pays today, averaged over its agencies at their share of the hours. */
  you: number
  hours: number
  cards: RateCard[]
}

/**
 * Compass's rates read against the whole market, role by role: what it pays, what the market pays, and where each of
 * its agencies sits. It stays one row per role however many agencies are on the program.
 */
export function MarketRates() {
  const data = useData()
  const [cityId, setCityId] = useState(CITIES[0].id)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const active = data.rateCards.filter((c) => c.cityId === cityId && c.status === "active")
    const agencies = [...new Set(active.map((c) => c.supplierId))]
    const lines = buildLines(data.rateCards, cityId, POSITIONS.map((p) => p.id), agencies)
    return lines
      .filter((l) => Object.keys(l.baseline).length)
      .map((l) => ({
        positionId: l.positionId,
        market: benchmark(cityId, l.positionId),
        you: Object.entries(l.baseline).reduce((sum, [s, rate]) => sum + rate * (l.share[s] ?? 0), 0),
        hours: estimatedHours(l.positionId, cityId),
        cards: active.filter((c) => c.positionId === l.positionId).sort((a, b) => a.billRate - b.billRate),
      }))
  }, [data.rateCards, cityId])

  const shown = rows.filter((r) => position(r.positionId).name.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = rows.find((r) => r.positionId === open)

  const exportCsv = () =>
    downloadCsv(
      exportName(`market-rates-${city(cityId).name.toLowerCase()}`),
      toCsv(
        rows.map((r) => ({
          city: city(cityId).name,
          role: position(r.positionId).name,
          you_pay: r.you.toFixed(2),
          market_median: r.market.median.toFixed(2),
          market_p25: r.market.p25.toFixed(2),
          market_p75: r.market.p75.toFixed(2),
          vs_market_pct: (vsMarket(r.you, r.market) * 100).toFixed(1),
        })),
      ),
    )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs value={cityId} onChange={setCityId} items={CITIES.map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))} />
        <span className="flex items-center gap-2">
          <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3 text-faded" onClick={exportCsv}>
            <Download className="size-4" /> Download
          </Button>
          <SearchInput value={query} onChange={setQuery} placeholder="Search roles" className="w-56" />
        </span>
      </div>
      <Surface elevated className="overflow-hidden" data-tour="market-rates">
        <div className="overflow-x-auto px-2 pt-3 scrollbar-thin">
          <table className="w-full min-w-[720px] text-body-3">
            <thead>
              <tr className="text-caption-1 text-faded">
                <th className="px-3 pb-2.5 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    Role <InfoTip>Every agency prices Compass&apos;s definition of the role, so rates compare like for like.</InfoTip>
                  </span>
                </th>
                <th className="px-3 pb-2.5 text-left font-medium">Agencies</th>
                <th className="px-3 pb-2.5 text-center font-medium">
                  <span className="inline-flex items-center gap-1">
                    You pay <InfoTip>The average bill rate across your agencies, at each one&apos;s share of the hours.</InfoTip>
                  </span>
                </th>
                <th className="px-3 pb-2.5 text-center font-medium">Market</th>
                <th className="w-[26%] px-3 pb-2.5 text-left font-medium">Against the market</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.positionId}
                  data-position={r.positionId}
                  onClick={() => setOpen(r.positionId)}
                  className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-hover/60"
                >
                  <td className="px-3 py-2.5 font-medium">
                    <Tip content={<RoleDefinition positionId={r.positionId} />}>
                      <span className="cursor-default">{position(r.positionId).name}</span>
                    </Tip>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <span className="flex -space-x-1">
                        {agenciesOn(r).map((id) => (
                          <SupplierLogo key={id} supplierId={id} size="xs" className="ring-2 ring-card" />
                        ))}
                      </span>
                      {agenciesOn(r).length === 1 && <span className="text-caption-1 font-medium whitespace-nowrap text-warning-fg">Only one</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold tabular">{money(r.you)}</td>
                  <td className="px-3 py-2.5 text-center text-faded tabular">{money(r.market.median)}</td>
                  <td className="px-3 py-2.5">
                    <BenchmarkBar
                      b={r.market}
                      marks={[...r.cards.map((c) => ({ value: c.billRate, kind: "bid" as const })), { value: r.you, kind: "today" as const }]}
                      toned
                    />
                  </td>
                  <td className="pr-3">
                    <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <EmptyState icon={MapPin} title="No roles match" description="Try another role or city." compact />}
        </div>
        <div className="border-t border-border/70 bg-page-faded/60 px-5 py-2.5">
          <BenchmarkLegend today="You pay" best="" toned />
        </div>
      </Surface>
      <Sheet open={!!selected} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" onOpenAutoFocus={(e) => e.preventDefault()} className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          {selected && <RoleRates row={selected} cityId={cityId} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

/** The agencies with a rate for the role, cheapest first. */
const agenciesOn = (r: Row) => [...new Set(r.cards.map((c) => c.supplierId))]

/** Compass's standard for a role, which every agency prices. */
function RoleDefinition({ positionId }: { positionId: string }) {
  const p = position(positionId)
  const needs = [p.foodHandler && requirementLabel("foodHandler"), p.alcohol && requirementLabel("alcohol")].filter(Boolean)
  return (
    <span className="flex max-w-64 flex-col gap-1">
      <span>{p.duties}</span>
      {needs.length > 0 && <span className="opacity-70">Needs: {needs.join(", ")}</span>}
    </span>
  )
}

/** One role in one city: the market up top, then each agency's rate card, cheapest first. */
function RoleRates({ row, cityId }: { row: Row; cityId: string }) {
  const b = row.market
  const stats = [
    { label: "Market median", value: money(b.median), sub: `${b.agencies} ${city(cityId).name} agencies` },
    { label: "Middle half", value: `${money(b.p25)}–${money(b.p75)}` },
    { label: "You pay", value: money(row.you), sub: <VsMarket value={vsMarket(row.you, b)} /> },
  ]
  return (
    <>
      <SheetHeader className="gap-1 border-b border-border px-6 pt-6 pb-5">
        <SheetTitle className="text-featured-3 font-semibold">{position(row.positionId).name}</SheetTitle>
        <SheetDescription className="text-body-3 text-faded">
          {city(cityId).name}, {city(cityId).state} · about {row.hours.toLocaleString("en-US")} hours a year
        </SheetDescription>
      </SheetHeader>
      <section className="flex flex-col gap-4 border-b border-border bg-page-faded/50 px-6 py-5">
        <dl className="grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt className="text-caption-1 text-faded">{s.label}</dt>
              <dd className="text-body-2 font-semibold tabular">{s.value}</dd>
              {s.sub && <dd className="text-caption-1 text-faded">{s.sub}</dd>}
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          <BenchmarkBar b={b} marks={[...row.cards.map((c) => ({ value: c.billRate, kind: "bid" as const })), { value: row.you, kind: "today" as const }]} toned className="h-5" />
          <span className="flex justify-between text-caption-2 text-faded tabular">
            <span>{money(b.low)}</span>
            <span>{money(b.high)}</span>
          </span>
        </div>
      </section>
      <section className="flex flex-col px-6 py-5">
        <h3 className="pb-3 text-body-3 font-semibold">Your agencies, lowest first</h3>
        <ol className="flex flex-col divide-y divide-border/70 rounded-xl border border-border">
          {row.cards.map((c) => (
            <li key={c.id}>
              <Link href={`/agencies/${c.supplierId}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover/50">
                <SupplierLogo supplierId={c.supplierId} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{supplier(c.supplierId).name}</span>
                  <span className="text-caption-1 text-faded">
                    Pay {money(c.proRate)} + {c.markupPct}%
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="font-semibold tabular">{money(c.billRate)}</span>
                  <VsMarket value={vsMarket(c.billRate, b)} className="text-caption-1" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

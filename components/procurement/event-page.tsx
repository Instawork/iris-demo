"use client"

import Link from "next/link"
import { Check, ChevronRight, CircleCheck, FileSearch, MessageSquareText, WandSparkles } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge, toneText, type Tone } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { BenchmarkBar, BenchmarkLegend, Change, StageBadge, Timeline, VsMarket, agencyStatus, moneyYear, termLabel, type Mark } from "@/components/procurement/sourcing-bits"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatDateFull, formatDateShort, formatTimestamp, timeAgo, todayISO } from "@/lib/dates"
import { billFrom, money, plural, round2 } from "@/lib/format"
import { city, position, supplier, termsOf } from "@/lib/reference"
import { benchmark, vsMarket, type Benchmark } from "@/lib/market"
import { activeCard, bestOn, bidsOf, counterPlan, irisCounters, latestBid, lineLabel, lineOf, marketName, netOf, offeredTerms, openCounters, responded, spendOf, type CounterOutcome } from "@/lib/sourcing"
import { useStore } from "@/lib/store"
import type { ContractTerms, SourcingEvent, SourcingLine } from "@/lib/types"
import { cn } from "@/lib/utils"

export function EventPage({ id }: { id: string }) {
  const data = useData()
  const { ws } = useWorkspace()
  const ev = (data.sourcing ?? []).find((e) => e.id === id)
  const isAgency = ws.kind === "supplier"
  if (!ev || ws.kind === "buyer" || (isAgency && !ev.invited.includes(ws.supplierId!))) {
    return (
      <div className="pt-10">
        <EmptyState
          icon={FileSearch}
          title="Event not found"
          description="It may belong to another workspace."
          actions={
            <Button asChild variant="outline">
              <Link href="/procurement">Back to Procurement</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-caption-1 text-faded">{ev.number}</span>
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-featured-1 font-semibold">
            {ev.title}
            <InfoTip className="size-[18px] [&>svg]:size-4">{`${marketName(ev)}, ${ev.lines.length} roles, ${ev.invited.length} agencies. Term ${termLabel(ev)}.`}</InfoTip>
            <StageBadge ev={ev} />
          </h1>
        </div>
        {!isAgency && ev.status === "open" && <ApproveBids ev={ev} />}
      </header>
      {isAgency ? <AgencyView ev={ev} supplierId={ws.supplierId!} /> : <CompassView ev={ev} />}
    </>
  )
}

/* --------------------------------- Compass -------------------------------- */

/** What Compass pays for a line today, averaged over its agencies at their share of the hours. */
const todayOn = (line: SourcingLine) => Object.entries(line.baseline).reduce((sum, [s, rate]) => sum + rate * (line.share[s] ?? 0), 0)

/** Every agency's latest bid on a line, lowest after VA first. */
const bidsOn = (ev: SourcingEvent, line: SourcingLine) =>
  ev.invited
    .flatMap((s) => {
      const bid = latestBid(ev, s)?.lines[line.id]
      return bid ? [{ supplierId: s, bid, net: netOf(ev, s, bid.billRate) }] : []
    })
    .sort((a, b) => a.net - b.net)

const VA_INFO = "VA is the rebate an agency pays Compass at year end, as a share of spend. Bids rank on what's left after it."

const years = (n: number) => `${n} yr${n === 1 ? "" : "s"}`

/** A term the agency offers, with what it has now beneath when the offer changes it. */
function TermCell({ value, was, better }: { value: string; was?: string; better?: boolean }) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-medium tabular">{value}</span>
      {was !== undefined && was !== value && <span className={cn("text-caption-1", better ? "text-positive-fg" : "text-faded")}>was {was}</span>}
    </span>
  )
}

const termsLine = (t: ContractTerms) => `${t.vaPct}% VA · Net ${t.netDays} · ${years(t.years)}`

/** An agency's latest bid against the market, weighted by its share of each role's hours. */
function agencyVsMarket(ev: SourcingEvent, supplierId: string) {
  let bid = 0
  let market = 0
  for (const line of ev.lines) {
    const rate = latestBid(ev, supplierId)?.lines[line.id]?.billRate
    if (rate === undefined) continue
    const hours = line.hours * (line.share[supplierId] ?? 1 / Math.max(1, Object.keys(line.share).length))
    bid += hours * rate
    market += hours * benchmark(ev.cityId, line.positionId).median
  }
  return market ? bid / market - 1 : undefined
}

type Selection = { kind: "role"; lineId: string } | { kind: "agency"; supplierId: string } | null

function CompassView({ ev }: { ev: SourcingEvent }) {
  const [view, setView] = useState<"role" | "agency">("role")
  const [open, setOpen] = useState<Selection>(null)
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
        <IrisNegotiates ev={ev} />
        <Surface elevated className="overflow-hidden" data-tour="bid-matrix">
          <SurfaceHeader
            title="Bids"
            info={`Each role's latest bids against the ${city(ev.cityId).name} market. Open a role to see every bid and counter it.`}
            actions={
              <PillTabs
                size="sm"
                value={view}
                onChange={setView}
                items={[
                  { value: "role", label: "By role" },
                  { value: "agency", label: "By agency", count: ev.invited.length },
                ]}
              />
            }
          />
          {view === "role" ? (
            <RoleTable ev={ev} onOpen={(lineId) => setOpen({ kind: "role", lineId })} />
          ) : (
            <AgencyTable ev={ev} onOpen={(supplierId) => setOpen({ kind: "agency", supplierId })} />
          )}
        </Surface>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Surface elevated className="pb-4">
          <SurfaceHeader title="Timeline" />
          <div className="px-5 pt-4">
            <Timeline ev={ev} />
          </div>
        </Surface>
        <Activity ev={ev} />
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" onOpenAutoFocus={(e) => e.preventDefault()} className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          {open?.kind === "role" && <RoleSheet ev={ev} line={lineOf(ev, open.lineId)} />}
          {open?.kind === "agency" && <AgencySheet ev={ev} supplierId={open.supplierId} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

const OUTCOME: Record<CounterOutcome, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  met: { label: "Met the ask", tone: "positive" },
  down: { label: "Came down", tone: "primary" },
  held: { label: "Held", tone: "neutral" },
}

const SHOWN = 5

/**
 * Iris negotiates the whole event at once: it counters every bid above the market, then shows each agency's answer as
 * it comes in. Countering role by role, agency by agency, is still there in each role's sheet for the exceptions.
 */
function IrisNegotiates({ ev }: { ev: SourcingEvent }) {
  const negotiate = useStore((s) => s.negotiateBids)
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(false)
  const sent = irisCounters(ev)
  const plan = sent.length ? [] : counterPlan(ev)
  if (!sent.length && !plan.length) return null

  const agencies = [...new Set((sent.length ? sent : plan).map((c) => c.supplierId))].map((s) => supplier(s).shortName)
  const waiting = sent.filter((c) => c.outcome === "waiting").length
  const count = (o: CounterOutcome) => sent.filter((c) => c.outcome === o).length
  const rows = sent.length
    ? sent.map((c) => ({ key: c.message.id, supplierId: c.supplierId, lineId: c.lineId, from: c.from, to: c.outcome === "waiting" ? c.ask : c.now, outcome: c.outcome as CounterOutcome | undefined }))
    : plan.map((c) => ({ key: `${c.supplierId}-${c.lineId}`, supplierId: c.supplierId, lineId: c.lineId, from: c.from, to: c.ask, outcome: undefined }))
  const shown = all ? rows : rows.slice(0, SHOWN)
  const title = !sent.length ? `${plural(plan.length, "bid")} above the market` : waiting ? "Iris is negotiating" : `Iris negotiated ${plural(sent.length, "rate")}`
  const detail = !sent.length
    ? `From ${listOf(agencies)}. Iris counters each one toward the ${city(ev.cityId).name} median.`
    : waiting
      ? `${sent.length - waiting} of ${sent.length} answered. Agencies usually answer within two days.`
      : listOf([count("met") && `${count("met")} met the ask`, count("down") && `${count("down")} came down`, count("held") && `${count("held")} held`].filter((x): x is string => !!x))

  return (
    <Surface elevated className="overflow-hidden" data-tour="iris-negotiate">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4 pb-3">
        <span className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <WandSparkles className={cn("size-4", waiting > 0 && "animate-pulse")} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-body-2 font-semibold">{title}</span>
            <span className="text-body-3 text-faded">{detail}</span>
          </span>
        </span>
      </div>
      <ol className="flex flex-col border-t border-border/70">
        {shown.map((r) => (
          <li key={r.key} className="flex items-center gap-3 border-b border-border/60 px-5 py-2 text-body-3 last:border-0" data-tour="iris-counter" data-outcome={r.outcome}>
            <SupplierLogo supplierId={r.supplierId} size="sm" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{supplier(r.supplierId).shortName}</span>
              <span className="text-faded"> · {lineLabel(ev, r.lineId)}</span>
            </span>
            <span className="text-faded tabular line-through decoration-foreground/25">{money(r.from)}</span>
            <span className="w-16 text-right font-semibold tabular">{money(r.to)}</span>
            {r.outcome && (
              <span className="flex w-24 justify-end">
                <StatusBadge tone={OUTCOME[r.outcome].tone} size="sm" dot={r.outcome === "waiting"}>
                  {OUTCOME[r.outcome].label}
                </StatusBadge>
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-page-faded/60 px-5 py-2.5">
        {rows.length > SHOWN ? (
          <Button variant="ghost" size="sm" className="-ml-2 text-faded" onClick={() => setAll((a) => !a)}>
            {all ? "Show less" : `Show all ${rows.length}`}
          </Button>
        ) : (
          <span />
        )}
        {!sent.length && (
          <Button
            className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold"
            disabled={busy}
            data-tour="negotiate"
            onClick={async () => {
              setBusy(true)
              await negotiate(ev.id)
              setBusy(false)
            }}
          >
            <WandSparkles className="size-4" /> Send {plural(plan.length, "counter")}
          </Button>
        )}
      </div>
    </Surface>
  )
}

const th = "px-3 pb-2.5 font-medium whitespace-nowrap"

/** One row per role, so it reads the same with four agencies or four hundred. */
function RoleTable({ ev, onOpen }: { ev: SourcingEvent; onOpen: (lineId: string) => void }) {
  return (
    <>
      <div className="overflow-x-auto px-2 pt-3 scrollbar-thin">
        <table className="w-full min-w-[720px] text-body-3">
          <thead>
            <tr className="text-caption-1 text-faded">
              <th className={cn(th, "text-left")}>Role</th>
              <th className={cn(th, "text-right")}>Today</th>
              <th className={cn(th, "text-right")}>
                <span className="inline-flex items-center gap-1">
                  Market
                  <InfoTip>{`The median bill rate for the role across ${benchmark(ev.cityId, ev.lines[0].positionId).agencies} ${city(ev.cityId).name} agencies.`}</InfoTip>
                </span>
              </th>
              <th className={cn(th, "text-right")}>
                <span className="inline-flex items-center gap-1">
                  Best bid
                  <InfoTip>{VA_INFO}</InfoTip>
                </span>
              </th>
              <th className={cn(th, "w-[22%] text-left")}>Against the market</th>
              <th className={cn(th, "text-right")}>vs market</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {ev.lines.map((line) => {
              const b = benchmark(ev.cityId, line.positionId)
              const bids = bidsOn(ev, line)
              const best = bids[0]
              const today = todayOn(line)
              const asked = ev.messages.some((m) => m.open && m.lineId === line.id)
              return (
                <tr
                  key={line.id}
                  data-tour="role-row"
                  data-position={line.positionId}
                  onClick={() => onOpen(line.id)}
                  className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-hover/60"
                >
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="font-medium whitespace-nowrap">{position(line.positionId).name}</span>
                      {asked && (
                        <StatusBadge tone="warning" size="sm">
                          Countered
                        </StatusBadge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-faded tabular">{today ? money(today) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-faded tabular">{money(b.median)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {best ? (
                      <span className="flex flex-col items-end">
                        <span className="font-semibold tabular">{money(best.bid.billRate)}</span>
                        <span className="text-caption-1 whitespace-nowrap text-faded">
                          {supplier(best.supplierId).shortName} · {offeredTerms(ev, best.supplierId).vaPct}% VA
                        </span>
                      </span>
                    ) : (
                      <span className="text-faded">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <BenchmarkBar
                      b={b}
                      marks={[...(today ? [{ value: today, kind: "today" as const }] : []), ...(best ? [{ value: best.bid.billRate, kind: "best" as const }] : [])]}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right text-caption-1 font-medium whitespace-nowrap">
                    <VsMarket value={best ? vsMarket(best.bid.billRate, b) : undefined} />
                  </td>
                  <td className="pr-3">
                    <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/70 bg-page-faded/60 px-5 py-2.5">
        <BenchmarkLegend />
      </div>
    </>
  )
}

/** One row per agency, most savings first. */
function AgencyTable({ ev, onOpen }: { ev: SourcingEvent; onOpen: (supplierId: string) => void }) {
  const [query, setQuery] = useState("")
  const rows = ev.invited
    .filter((s) => supplier(s).name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((s) => ({ s, spend: spendOf(ev, s), bid: latestBid(ev, s), status: agencyStatus(ev, s) }))
    .sort((a, b) => Number(!!b.bid) - Number(!!a.bid) || b.spend.savings - a.spend.savings)
  return (
    <>
      {ev.invited.length > 8 && (
        <div className="px-5 pt-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search agencies" className="w-64" />
        </div>
      )}
      <div className="overflow-x-auto px-2 pt-3 pb-2 scrollbar-thin">
        <table className="w-full min-w-[720px] text-body-3">
          <thead>
            <tr className="text-caption-1 text-faded">
              <th className={cn(th, "text-left")}>Agency</th>
              <th className={cn(th, "text-right")}>
                <span className="inline-flex items-center gap-1">
                  VA
                  <InfoTip>{VA_INFO}</InfoTip>
                </span>
              </th>
              <th className={cn(th, "text-right")}>Payment</th>
              <th className={cn(th, "text-right")}>Contract</th>
              <th className={cn(th, "text-right")}>
                <span className="inline-flex items-center gap-1">
                  A year
                  <InfoTip>At today&apos;s share of the hours, after VA.</InfoTip>
                </span>
              </th>
              <th className={cn(th, "text-right")}>vs today</th>
              <th className={cn(th, "text-right")}>vs market</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, spend, bid, status }) => {
              const now = termsOf(s)
              const offer = offeredTerms(ev, s)
              return (
              <tr key={s} data-supplier={s} onClick={() => onOpen(s)} className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-hover/60">
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <SupplierLogo supplierId={s} size="sm" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{supplier(s).name}</span>
                      <span className={cn("text-caption-1", status.tone === "neutral" || status.tone === "primary" ? "text-faded" : toneText[status.tone])}>
                        {status.label === "Invited" ? "No bid yet" : status.label}
                        {bid && Object.keys(bid.lines).length < ev.lines.length ? ` · ${Object.keys(bid.lines).length} of ${ev.lines.length} roles` : ""}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <TermCell value={`${offer.vaPct}%`} was={`${now.vaPct}%`} better={offer.vaPct > now.vaPct} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <TermCell value={`Net ${offer.netDays}`} was={`Net ${now.netDays}`} better={offer.netDays > now.netDays} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <TermCell value={years(offer.years)} was={years(now.years)} />
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular">{bid ? moneyYear(spend.proposed) : "—"}</td>
                <td className="px-3 py-2.5 text-right">{bid ? <Change value={spend.baseline ? spend.proposed / spend.baseline - 1 : undefined} /> : <span className="text-faded">—</span>}</td>
                <td className="px-3 py-2.5 text-right text-caption-1 font-medium">
                  <VsMarket value={bid ? agencyVsMarket(ev, s) : undefined} />
                </td>
                <td className="pr-3">
                  <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** A role's market benchmark up top, then every bid on it, lowest first, each one counterable. */
function RoleSheet({ ev, line }: { ev: SourcingEvent; line: SourcingLine }) {
  const b = benchmark(ev.cityId, line.positionId)
  const bids = bidsOn(ev, line)
  const today = todayOn(line)
  const waiting = ev.invited.filter((s) => line.baseline[s] !== undefined && !latestBid(ev, s)?.lines[line.id])
  return (
    <>
      <SheetHeader className="gap-1 border-b border-border px-6 pt-6 pb-5">
        <SheetTitle className="text-featured-3 font-semibold">{position(line.positionId).name}</SheetTitle>
        <SheetDescription className="text-body-3 text-faded">
          {city(ev.cityId).name} · {line.hours.toLocaleString("en-US")} hours a year
        </SheetDescription>
      </SheetHeader>
      <MarketBlock b={b} today={today} marks={[...bids.slice(1).map((x) => ({ value: x.bid.billRate, kind: "bid" as const })), ...(today ? [{ value: today, kind: "today" as const }] : []), ...(bids[0] ? [{ value: bids[0].bid.billRate, kind: "best" as const }] : [])]} cityId={ev.cityId} />
      <section className="flex flex-col gap-1 px-6 py-5">
        <h3 className="flex items-center gap-1 pb-2 text-body-3 font-semibold">
          Bids, lowest after VA first
          <InfoTip>{VA_INFO}</InfoTip>
        </h3>
        {bids.length ? (
          <ol className="flex flex-col divide-y divide-border/70 rounded-xl border border-border">
            {bids.map((x, i) => (
              <BidRow key={x.supplierId} ev={ev} line={line} supplierId={x.supplierId} market={b} lead={<SupplierLogo supplierId={x.supplierId} size="md" />} title={supplier(x.supplierId).name} best={i === 0 && bids.length > 1} />
            ))}
          </ol>
        ) : (
          <p className="text-body-3 text-faded">No bids on this role yet.</p>
        )}
        {waiting.length > 0 && (
          <p className="pt-3 text-caption-1 text-faded">
            No bid yet from {listOf(waiting.map((s) => supplier(s).shortName))}.
          </p>
        )}
      </section>
    </>
  )
}

/** One agency's bid, role by role, against the market. */
function AgencySheet({ ev, supplierId }: { ev: SourcingEvent; supplierId: string }) {
  const bid = latestBid(ev, supplierId)
  const spend = spendOf(ev, supplierId)
  const status = agencyStatus(ev, supplierId)
  const lines = ev.lines.filter((l) => bid?.lines[l.id])
  return (
    <>
      <SheetHeader className="flex-row items-center gap-3 border-b border-border px-6 pt-6 pb-5">
        <SupplierLogo supplierId={supplierId} size="lg" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <SheetTitle className="truncate text-featured-3 font-semibold">{supplier(supplierId).name}</SheetTitle>
          <SheetDescription className="text-body-3 text-faded">
            {status.label === "Approved" ? "Approved" : status.label === "Countered" ? "Countered" : bid ? `Round ${bid.round}` : "Hasn't bid yet"}
            {bid ? ` · sent ${formatTimestamp(bid.at)}` : ""}
            <span className="block">{termsLine(offeredTerms(ev, supplierId))}</span>
          </SheetDescription>
        </span>
      </SheetHeader>
      {bid && (
        <dl className="grid grid-cols-3 divide-x divide-border border-b border-border text-body-3">
          {[
            { label: "A year", value: moneyYear(spend.proposed) },
            { label: "vs today", value: <Change value={spend.baseline ? spend.proposed / spend.baseline - 1 : undefined} /> },
            { label: "vs market", value: <VsMarket value={agencyVsMarket(ev, supplierId)} /> },
          ].map((c) => (
            <div key={c.label} className="flex flex-col gap-0.5 px-6 py-4">
              <dt className="text-caption-1 text-faded">{c.label}</dt>
              <dd className="text-body-2 font-semibold tabular">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <section className="flex flex-col px-6 py-5">
        {lines.length ? (
          <ol className="flex flex-col divide-y divide-border/70 rounded-xl border border-border">
            {lines.map((l) => (
              <BidRow key={l.id} ev={ev} line={l} supplierId={supplierId} market={benchmark(ev.cityId, l.positionId)} title={position(l.positionId).name} best={bestOn(ev, l.id)?.supplierId === supplierId && responded(ev).length > 1} />
            ))}
          </ol>
        ) : (
          <p className="text-body-3 text-faded">Nothing to compare until {supplier(supplierId).shortName} bids.</p>
        )}
      </section>
    </>
  )
}

function MarketBlock({ b, today, marks, cityId }: { b: Benchmark; today?: number; marks: Mark[]; cityId: string }) {
  const stats = [
    { label: "Market median", value: money(b.median), sub: `${b.agencies} ${city(cityId).name} agencies` },
    { label: "Middle half", value: `${money(b.p25)}–${money(b.p75)}` },
    { label: "You pay today", value: today ? money(today) : "—", sub: today ? <VsMarket value={vsMarket(today, b)} /> : undefined },
  ]
  return (
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
        <BenchmarkBar b={b} marks={marks} className="h-5" />
        <span className="flex justify-between text-caption-2 text-faded tabular">
          <span>{money(b.low)}</span>
          <span>{money(b.high)}</span>
        </span>
      </div>
    </section>
  )
}

/** One bid on one role, with its history a click away and a counter right in the row. */
function BidRow({
  ev,
  line,
  supplierId,
  market,
  lead,
  title,
  best,
}: {
  ev: SourcingEvent
  line: SourcingLine
  supplierId: string
  market: Benchmark
  lead?: React.ReactNode
  title: string
  best: boolean
}) {
  const counter = useStore((s) => s.counterBid)
  const bid = latestBid(ev, supplierId)!.lines[line.id]
  const asked = openCounters(ev, supplierId).find((m) => m.lineId === line.id)
  const field = bestOn(ev, line.id)
  const va = offeredTerms(ev, supplierId).vaPct
  const net = netOf(ev, supplierId, bid.billRate)
  const locked = !!ev.approved[supplierId] || ev.status === "awarded"
  const first = bidsOf(ev, supplierId).find((b) => b.lines[line.id])?.lines[line.id]
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
    <li className="flex flex-col" data-tour="bid-row" data-supplier={supplierId} data-position={line.positionId}>
      <div className="flex items-center gap-3 px-4 py-3">
        {lead}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{title}</span>
            {best && (
              <Tip content="Lowest after VA">
                <span>
                  <StatusBadge tone="positive" size="sm">
                    Best
                  </StatusBadge>
                </span>
              </Tip>
            )}
          </span>
          <Tip content={`Pay ${money(bid.proRate)} + ${bid.markupPct}% markup · ${va}% VA${first && first.billRate !== bid.billRate ? ` · first bid ${money(first.billRate)}` : ""}`}>
            <span className="w-fit cursor-default text-caption-1 text-faded">{bid.markupPct}% markup</span>
          </Tip>
        </span>
        <span className="flex flex-col items-end">
          <span className="font-semibold tabular">{money(bid.billRate)}</span>
          <Tip content={`${money(bid.billRate)} less ${va}% VA`}>
            <span className="text-caption-1 text-faded tabular">{money(net)} after VA</span>
          </Tip>
        </span>
        <span className="flex w-[84px] shrink-0 justify-end">
          {locked ? (
            <span className="flex items-center gap-1 text-caption-1 font-medium text-positive-fg">
              <CircleCheck className="size-3.5" /> Approved
            </span>
          ) : asked ? (
            <Tip content={`Waiting on ${supplier(supplierId).contactName.split(" ")[0]}`}>
              <span className="text-right text-caption-1 font-medium text-warning-fg">Asked {money(asked.ask!)}</span>
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
          className="flex items-center gap-2 border-t border-border/70 bg-page-faded/60 px-4 py-3"
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
          <span className="flex-1 truncate text-caption-1 text-faded">Market {money(market.median)}</span>
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

function ApproveBids({ ev }: { ev: SourcingEvent }) {
  const approve = useStore((s) => s.approveBids)
  const [open, setOpen] = useState(false)
  const pending = responded(ev).filter((s) => !ev.approved[s])
  const ready = pending.filter((s) => !openCounters(ev, s).length)
  const [picked, setPicked] = useState<string[]>([])
  const chosen = picked.filter((s) => ready.includes(s))
  const total = chosen.reduce(
    (t, s) => {
      const spend = spendOf(ev, s)
      return { baseline: t.baseline + spend.baseline, proposed: t.proposed + spend.proposed }
    },
    { baseline: 0, proposed: 0 },
  )
  const go = () =>
    void approve(ev.id, chosen).then((n) => {
      if (!n) return
      setOpen(false)
      toast.success(n === 1 ? `${supplier(chosen[0]).shortName}'s bid is approved` : `${n} bids approved`, { description: `The new rates are live on the ${city(ev.cityId).name} rate cards.` })
    })
  return (
    <>
      <Button
        className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold"
        disabled={!ready.length}
        onClick={() => (setPicked(ready), setOpen(true))}
        data-tour="approve-all"
        title={pending.length && !ready.length ? "Every bid is waiting on an answer to a counter" : undefined}
      >
        <Check className="size-4" /> Approve bids
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve bids</DialogTitle>
            <DialogDescription>Approved prices go live on each agency&apos;s {city(ev.cityId).name} rate card today.</DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border scrollbar-thin">
            {pending.map((s) => {
              const spend = spendOf(ev, s)
              const waiting = !ready.includes(s)
              return (
                <li key={s}>
                  <label className={cn("flex items-center gap-3 px-4 py-3", waiting ? "opacity-60" : "cursor-pointer hover:bg-hover/50")}>
                    <Checkbox
                      checked={chosen.includes(s)}
                      disabled={waiting}
                      onCheckedChange={(on) => setPicked((p) => (on ? [...p, s] : p.filter((x) => x !== s)))}
                    />
                    <SupplierLogo supplierId={s} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{supplier(s).name}</span>
                      <span className="text-caption-1 text-faded">{waiting ? "Waiting on an answer to your counter" : `Round ${latestBid(ev, s)!.round}`}</span>
                    </span>
                    <span className="flex flex-col items-end">
                      <span className="text-body-3 font-semibold tabular">{moneyYear(spend.proposed)}</span>
                      <Change value={spend.baseline ? spend.proposed / spend.baseline - 1 : undefined} />
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {chosen.length > 0 && total.baseline > total.proposed && (
            <p className="text-body-3 text-faded">
              Saves <span className="font-semibold text-positive-fg">{moneyYear(total.baseline - total.proposed)}</span> a year against today&apos;s rates.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!chosen.length} onClick={go}>
              Approve {chosen.length === 1 ? "1 bid" : `${chosen.length} bids`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* -------------------------------- Activity -------------------------------- */

interface Entry {
  key: string
  at: string
  supplierId?: string
  who: string
  org: string
  text: string
  waiting?: boolean
}

const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

function entriesOf(ev: SourcingEvent, supplierId?: string): Entry[] {
  const messages: Entry[] = ev.messages
    .filter((m) => !supplierId || m.supplierId === supplierId)
    .map((m) => ({
      key: m.id,
      at: m.at,
      supplierId: m.from === "agency" ? m.supplierId : undefined,
      who: m.by,
      org: m.from === "compass" ? `Compass to ${supplierId ? "you" : supplier(m.supplierId).shortName}` : supplier(m.supplierId).shortName,
      text: m.text,
      waiting: m.open,
    }))
  const bids: Entry[] = ev.bids
    .filter((b) => b.round === 1 && (!supplierId || b.supplierId === supplierId))
    .map((b) => ({ key: `${b.supplierId}-bid`, at: b.at, supplierId: b.supplierId, who: b.by, org: supplier(b.supplierId).shortName, text: `Sent a bid on ${Object.keys(b.lines).length} roles.` }))
  const byTime = new Map<string, string[]>()
  for (const [s, at] of Object.entries(ev.approved)) if (!supplierId || s === supplierId) byTime.set(at, [...(byTime.get(at) ?? []), s])
  const approvals: Entry[] = [...byTime].map(([at, ids]) => ({
    key: `${at}-ok`,
    at,
    who: ev.createdBy,
    org: "Compass",
    text: supplierId ? "Approved your bid. The rates are live." : `Approved ${listOf(ids.map((s) => supplier(s).shortName))}. The rates are live.`,
  }))
  return [...messages, ...bids, ...approvals].sort((a, b) => b.at.localeCompare(a.at))
}

function Activity({ ev, supplierId }: { ev: SourcingEvent; supplierId?: string }) {
  const [all, setAll] = useState(false)
  const entries = entriesOf(ev, supplierId)
  const shown = all ? entries : entries.slice(0, 5)
  return (
    <Surface elevated className="pb-2">
      <SurfaceHeader title={supplierId ? "Messages" : "Activity"} description={entries.length ? undefined : "Nothing yet"} />
      {entries.length ? (
        <ol className="flex flex-col px-5 pt-2">
          {shown.map((e) => (
            <li key={e.key} className="flex gap-3 border-b border-border/60 py-3 last:border-0">
              {e.supplierId ? (
                <SupplierLogo supplierId={e.supplierId} size="sm" />
              ) : (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-foreground text-[10px] font-semibold text-background">CG</span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body-3">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    <span className="font-semibold">{e.who}</span> <span className="text-caption-1 text-faded">{e.org}</span>
                  </span>
                  <span className="shrink-0 text-caption-1 text-faded" title={formatTimestamp(e.at)}>
                    {timeAgo(e.at)}
                  </span>
                </span>
                <span className="text-foreground/90">{e.text}</span>
                {e.waiting && <span className="text-caption-1 font-medium text-warning-fg">Waiting on an answer</span>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-5 pt-3 pb-3">
          <p className="flex items-center gap-2 text-caption-1 text-faded">
            <MessageSquareText className="size-3.5" /> Bids and counters show up here.
          </p>
        </div>
      )}
      {entries.length > 5 && (
        <div className="px-3">
          <Button variant="ghost" size="sm" className="w-full text-faded" onClick={() => setAll((a) => !a)}>
            {all ? "Show less" : `Show all ${entries.length}`}
          </Button>
        </div>
      )}
    </Surface>
  )
}

/* --------------------------------- Agency --------------------------------- */

function AgencyView({ ev, supplierId }: { ev: SourcingEvent; supplierId: string }) {
  const data = useData()
  const submit = useStore((s) => s.submitBid)
  const bid = latestBid(ev, supplierId)
  const counters = openCounters(ev, supplierId)
  const approvedAt = ev.approved[supplierId]
  const locked = !!approvedAt || ev.status === "awarded"
  const [form, setForm] = useState<Record<string, { pay: string; markup: string }>>(() =>
    Object.fromEntries(
      ev.lines.map((l) => {
        const v = bid?.lines[l.id] ?? activeCard(data.rateCards, supplierId, ev.cityId, l.positionId)
        return [l.id, { pay: v ? v.proRate.toFixed(2) : "", markup: v ? String(v.markupPct) : "" }]
      }),
    ),
  )
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const set = (lineId: string, patch: Partial<{ pay: string; markup: string }>) => setForm((f) => ({ ...f, [lineId]: { ...f[lineId], ...patch } }))

  const priced = ev.lines.flatMap((l) => {
    const f = form[l.id]
    const pay = Number(f?.pay)
    const markup = Number(f?.markup)
    return pay > 0 && f?.markup !== "" && markup >= 0 ? [{ line: l, pay, markup, bill: billFrom(pay, markup) }] : []
  })
  const billings = priced.reduce((sum, p) => sum + p.line.hours * (p.line.share[supplierId] ?? 0) * p.bill, 0)
  const today = spendOf(ev, supplierId, true).baseline
  const round = (bid?.round ?? 0) + 1
  const status = agencyStatus(ev, supplierId)

  const send = async () => {
    setBusy(true)
    const n = await submit(
      ev.id,
      Object.fromEntries(priced.map((p) => [p.line.id, { proRate: p.pay, markupPct: p.markup }])),
      note.trim() || undefined,
    )
    setBusy(false)
    if (!n) return
    setNote("")
    toast.success(n === 1 ? "Bid sent to Compass" : `Round ${n} sent to Compass`, { description: "Compass's answer shows up here." })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
        {approvedAt ? (
          <Banner tone="positive" icon={CircleCheck}>
            Compass approved your bid on {formatDateFull(approvedAt.slice(0, 10))}. These rates are live on your rate card.{" "}
            <Link href="/procurement?tab=rates" className="font-medium underline underline-offset-4">
              See your rate cards
            </Link>
          </Banner>
        ) : counters.length ? (
          <Banner tone="warning" icon={MessageSquareText}>
            Compass countered {counters.length === 1 ? "one of your rates" : `${counters.length} of your rates`}. Accept the ask or send your best, then send round {round}.
          </Banner>
        ) : null}
        <Surface elevated className="overflow-hidden" data-tour="agency-bid">
          <SurfaceHeader
            title={bid ? `Your bid, round ${bid.round}` : "Your bid"}
            description={bid ? `Sent ${formatTimestamp(bid.at)}` : `Due ${formatDateShort(ev.closesOn)}`}
            info="Hours are Compass's estimate for the year. Leave a role blank to skip it."
          />
          <div className="overflow-x-auto px-2 pt-3 scrollbar-thin">
            <table className="w-full min-w-[640px] text-body-3">
              <thead>
                <tr className="text-caption-1 text-faded">
                  <th className="px-3 pb-2 text-left font-medium">Role</th>
                  <th className="px-3 pb-2 text-right font-medium">Hours a year</th>
                  <th className="px-3 pb-2 text-right font-medium">Today</th>
                  <th className="px-3 pb-2 text-right font-medium">Pay rate</th>
                  <th className="px-3 pb-2 text-right font-medium">Markup</th>
                  <th className="px-3 pb-2 text-right font-medium">Bill rate</th>
                </tr>
              </thead>
              <tbody>
                {ev.lines.map((l) => {
                  const f = form[l.id]
                  const pay = Number(f?.pay)
                  const markup = Number(f?.markup)
                  const bill = pay > 0 && f?.markup !== "" ? billFrom(pay, markup) : undefined
                  const ask = locked ? undefined : counters.find((m) => m.lineId === l.id)
                  const was = l.baseline[supplierId]
                  return (
                    <tr key={l.id} className={cn("border-t border-border/70", ask && "bg-warning-faded/50")}>
                      <td className="px-3 py-2">
                        <span className="flex flex-col">
                          <span className="font-medium">{position(l.positionId).name}</span>
                          {ask && (
                            <span className="text-caption-1 text-warning-fg">
                              Compass asks {money(ask.ask!)}
                              <button
                                type="button"
                                className="ml-2 font-semibold underline-offset-4 hover:underline"
                                onClick={() => pay > 0 && set(l.id, { markup: String(round2((ask.ask! / pay - 1) * 100)) })}
                              >
                                Accept
                              </button>
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-faded tabular">{l.hours.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 text-right text-faded tabular">{was ? money(was) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <NumberField prefix="$" value={f?.pay ?? ""} disabled={locked} label={`${position(l.positionId).name} pay rate`} onChange={(v) => set(l.id, { pay: v })} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberField
                          suffix="%"
                          value={f?.markup ?? ""}
                          disabled={locked}
                          label={`${position(l.positionId).name} markup`}
                          onChange={(v) => set(l.id, { markup: v })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="flex flex-col items-end">
                          <span className="font-semibold tabular">{bill ? money(bill) : "—"}</span>
                          {bill && was ? <Change value={bill / was - 1} /> : null}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!locked && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border bg-page-faded/60 px-5 py-3">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to Compass (optional)" className="h-9 min-w-56 flex-1 rounded-lg bg-card" />
              <Button className="h-9" disabled={busy || !priced.length} onClick={send} data-tour="submit-bid">
                {bid ? `Send round ${round}` : "Submit bid"}
              </Button>
            </div>
          )}
        </Surface>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Surface elevated className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-3 text-faded">Your bid</span>
            <StatusBadge tone={status.tone} size="sm" dot>
              {status.label === "Invited" ? "Not sent yet" : status.label}
            </StatusBadge>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[30px] leading-10 font-semibold tracking-[-0.03em] tabular">{moneyYear(billings)}</span>
            <span className="text-caption-1 text-faded">A year at your share of the hours</span>
          </div>
          <dl className="flex flex-col gap-2 border-t border-border/70 pt-4 text-body-3">
            <div className="flex justify-between gap-3">
              <dt className="text-faded">At today&apos;s rates</dt>
              <dd className="font-medium tabular">{moneyYear(today)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faded">Your terms</dt>
              <dd className="font-medium">{termsLine(offeredTerms(ev, supplierId))}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faded">Roles priced</dt>
              <dd className="font-medium tabular">
                {priced.length} of {ev.lines.length}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faded">{todayISO() > ev.closesOn ? "Bids closed" : "Bids due"}</dt>
              <dd className="font-medium">{formatDateFull(ev.closesOn)}</dd>
            </div>
          </dl>
        </Surface>
        <Surface elevated className="pb-4">
          <SurfaceHeader title="Timeline" />
          <div className="px-5 pt-4">
            <Timeline ev={ev} />
          </div>
        </Surface>
        <Activity ev={ev} supplierId={supplierId} />
      </div>
    </div>
  )
}

function Banner({ tone, icon: Icon, children }: { tone: "positive" | "warning"; icon: typeof CircleCheck; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-body-3",
        tone === "positive" ? "border-positive-border/80 bg-positive-faded" : "border-warning-border/80 bg-warning-faded",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "positive" ? "text-positive-fg" : "text-warning-fg")} />
      <span>{children}</span>
    </div>
  )
}

function NumberField({
  value,
  onChange,
  prefix,
  suffix,
  disabled,
  invalid,
  label,
}: {
  value: string
  onChange: (v: string) => void
  prefix?: string
  suffix?: string
  disabled?: boolean
  invalid?: boolean
  label: string
}) {
  if (disabled) return <span className="tabular">{value ? `${prefix ?? ""}${value}${suffix ?? ""}` : "—"}</span>
  return (
    <span className="relative ml-auto inline-block w-24">
      {prefix && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-body-3 text-faded">{prefix}</span>}
      <input
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className={cn(
          "h-8 w-full rounded-md border border-input bg-card text-right text-body-3 font-medium tabular outline-none transition-shadow focus:border-primary/60 focus:ring-2 focus:ring-primary/15",
          prefix ? "pr-2.5 pl-6" : "pr-7 pl-2.5",
          invalid && "border-critical-border text-critical-fg",
        )}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-body-3 text-faded">{suffix}</span>}
    </span>
  )
}

"use client"

import Link from "next/link"
import { Check, ChevronRight, CircleCheck, FileSearch, MessageSquareText, WandSparkles } from "lucide-react"
import { Fragment, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { StatusBadge, toneText, type Tone } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { Change, StageBadge, agencyStatus, moneyYear, termLabel } from "@/components/procurement/sourcing-bits"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useData, useWorkspace } from "@/hooks/use-app"
import { dateOf, formatDateFull, formatDateShort, formatTimestamp, timeAgo, todayISO } from "@/lib/dates"
import { billFrom, money, plural } from "@/lib/format"
import { city, position, supplier } from "@/lib/reference"
import { activeCard, agencyValue, bestMarkup, counterPlan, irisCounters, latestBid, lineName, marketName, marketsOf, offeredTerms, openCounters, pct, responded, spendOf, type CounterOutcome } from "@/lib/sourcing"
import { useStore } from "@/lib/store"
import type { ContractTerms, SourcingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

export function EventPage({ id, embedded = false }: { id: string; embedded?: boolean }) {
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
      <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", !embedded && "pt-4")}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-caption-1 text-faded">{ev.number}</span>
          <h1 className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold", embedded ? "text-featured-3" : "text-featured-1")}>
            {ev.title}
            <InfoTip className="size-[18px] [&>svg]:size-4">{`${marketName(ev)}. ${new Set(ev.lines.map((l) => l.positionId)).size} roles, ${ev.invited.length} agencies. Term ${termLabel(ev)}.`}</InfoTip>
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

export const termsLine = (t: ContractTerms) => `${t.vaPct}% VA · Net ${t.netDays} · ${t.years} yr${t.years === 1 ? "" : "s"}`


function CompassView({ ev }: { ev: SourcingEvent }) {
  return (
    <div className="flex flex-col gap-4">
      <ValueBoard ev={ev} />
      <IrisNegotiates ev={ev} />
    </div>
  )
}

const BOARD = "grid grid-cols-[minmax(240px,1fr)_120px_220px_120px_20px] items-center gap-x-8 px-6"

/**
 * Every agency's bid in three numbers: its markup, what it pays workers against the market, and the VA it gives back.
 * Best value after VA first.
 */
function ValueBoard({ ev }: { ev: SourcingEvent }) {
  const data = useData()
  const [query, setQuery] = useState("")
  const rows = ev.invited
    .map((s) => ({ s, ...agencyValue(ev, data.rateCards, s), status: agencyStatus(ev, s) }))
    .sort((a, b) => Number(b.bidding) - Number(a.bidding) || a.cost - b.cost)
  const span = Math.max(0.05, ...rows.map((r) => Math.abs(r.payVsMarket) * 1.25))
  const shown = rows.filter((r) => supplier(r.s).name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <Surface elevated className="overflow-hidden" data-tour="bid-matrix">
      <SurfaceHeader
        title="Compare agencies"
        info="vs Market is what each agency pays workers against the market, averaged over every role and market by the hours you buy. The line in the middle is the market."
        actions={ev.invited.length > 8 ? <SearchInput value={query} onChange={setQuery} placeholder="Search agencies" className="w-52" /> : undefined}
      />
      <div className={cn(BOARD, "mt-3 border-y border-border/70 bg-page-faded/60 py-2.5 text-caption-1 font-medium text-faded")}>
        <span>Agency</span>
        <span className="text-center">Markup</span>
        <span className="text-center">vs Market</span>
        <span className="text-center">VA</span>
        <span />
      </div>
      <ol className="flex flex-col divide-y divide-border/70">
        {shown.map((r) => (
          <li key={r.s}>
            <Link href={`/procurement/${ev.id}/${r.s}`} data-supplier={r.s} className={cn(BOARD, "group py-4 transition-colors hover:bg-hover/50")}>
              <span className="flex min-w-0 items-center gap-3">
                <SupplierLogo supplierId={r.s} size="md" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body-2 font-semibold">{supplier(r.s).name}</span>
                  <span className={cn("text-caption-1", r.status.tone === "neutral" || r.status.tone === "primary" ? "text-faded" : toneText[r.status.tone])}>
                    {r.bidding ? r.status.label : "No bid yet, today's rates"}
                  </span>
                </span>
              </span>
              <span className="text-center text-body-1 font-semibold tabular">{pct(Math.round(r.markupPct))}</span>
              <Tip content={`Pays ${money(1 + r.payVsMarket)} for every $1.00 the market pays`}>
                <span className="flex justify-center">
                  <PayDot value={r.payVsMarket} span={span} />
                </span>
              </Tip>
              <span className="text-center text-body-1 font-semibold tabular">{pct(r.vaPct)}</span>
              <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ol>
    </Surface>
  )
}

/** Where an agency's pay sits against the market: the tick is the market, and the bar runs to a dot, green above and red below. */
function PayDot({ value, span }: { value: number; span: number }) {
  const n = Math.round(value * 100)
  const tone = n > 0 ? "positive" : n < 0 ? "critical" : "neutral"
  const at = 50 + (Math.max(-span, Math.min(span, value)) / span) * 50
  return (
    <span className="flex items-center gap-3">
      <span className="w-9" aria-hidden />
      <span className="relative block h-4 w-32" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/[0.07]" />
        <span
          className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded-full", tone === "positive" ? "bg-positive/35" : "bg-critical/35")}
          style={{ left: `${Math.min(50, at)}%`, width: `${Math.abs(at - 50)}%` }}
        />
        <span className="absolute top-1/2 left-1/2 h-3.5 w-px -translate-y-1/2 bg-foreground/40" />
        <span
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
            tone === "positive" ? "bg-positive" : tone === "critical" ? "bg-critical" : "bg-foreground/50",
          )}
          style={{ left: `${at}%` }}
        />
      </span>
      <span className={cn("w-9 text-right text-body-3 font-semibold tabular", tone === "positive" ? "text-positive-fg" : tone === "critical" ? "text-critical-fg" : "text-faded")}>
        {n > 0 ? "+" : n < 0 ? "−" : ""}
        {Math.abs(n)}%
      </span>
    </span>
  )
}

const OUTCOME: Record<CounterOutcome, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  met: { label: "Met it", tone: "positive" },
  down: { label: "Came down", tone: "primary" },
  held: { label: "Held", tone: "neutral" },
}

/**
 * Iris negotiates the whole event at once: it asks every agency above the lowest markup to come down, then shows each
 * answer as it comes in. Countering one agency by hand is on that agency's page.
 */
function IrisNegotiates({ ev }: { ev: SourcingEvent }) {
  const negotiate = useStore((s) => s.negotiateBids)
  const [busy, setBusy] = useState(false)
  const sent = irisCounters(ev)
  const plan = sent.length ? [] : counterPlan(ev)
  if (!sent.length && !plan.length) return null

  const waiting = sent.filter((c) => c.outcome === "waiting").length
  const count = (o: CounterOutcome) => sent.filter((c) => c.outcome === o).length
  const rows = sent.length
    ? sent.map((c) => ({ key: c.message.id, supplierId: c.supplierId, from: c.from, ask: c.ask, now: c.now, outcome: c.outcome as CounterOutcome | undefined }))
    : plan.map((c) => ({ key: c.supplierId, supplierId: c.supplierId, from: c.from, ask: c.ask, now: c.from, outcome: undefined }))
  const worth = (sent.length ? sent : plan).reduce((sum, c) => sum + c.saves, 0)
  const title = !sent.length ? `${plural(plan.length, "agency", "agencies")} above the lowest markup` : waiting ? "Iris is negotiating" : `Iris negotiated ${plural(sent.length, "markup")}`
  const detail = !sent.length
    ? `Iris asks each to come down toward ${pct(bestMarkup(ev))}. Worth ${moneyYear(worth)} if they all say yes.`
    : waiting
      ? `${sent.length - waiting} of ${sent.length} answered. Agencies usually answer within two days.`
      : `${listOf([count("met") && `${count("met")} met the ask`, count("down") && `${count("down")} came down`, count("held") && `${count("held")} held`].filter((x): x is string => !!x))}.${worth > 0 ? ` That saves ${moneyYear(worth)}.` : ""}`

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
      <div className="flex items-center gap-3 border-t border-border/70 px-5 pt-2 pb-1 text-caption-1 text-faded">
        <span className="flex-1">Agency</span>
        <span className="w-24 text-right">Their markup</span>
        <span className="w-20 text-right">Iris asks</span>
        {sent.length > 0 && <span className="w-28 text-right">Answer</span>}
      </div>
      <ol className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 border-b border-border/60 px-5 py-2.5 text-body-3 last:border-0" data-tour="iris-counter" data-outcome={r.outcome}>
            <SupplierLogo supplierId={r.supplierId} size="sm" />
            <span className="min-w-0 flex-1 truncate font-medium">{supplier(r.supplierId).shortName}</span>
            <span className="w-24 text-right text-faded tabular">{pct(r.from)}</span>
            <span className="w-20 text-right font-semibold tabular">{pct(r.ask)}</span>
            {r.outcome && (
              <span className="flex w-28 justify-end">
                <StatusBadge tone={OUTCOME[r.outcome].tone} size="sm" dot={r.outcome === "waiting"}>
                  {r.outcome === "down" ? `Down to ${pct(r.now)}` : OUTCOME[r.outcome].label}
                </StatusBadge>
              </span>
            )}
          </li>
        ))}
      </ol>
      {!sent.length && (
        <div className="flex items-center justify-end gap-3 border-t border-border/70 bg-page-faded/60 px-5 py-2.5">
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
        </div>
      )}
    </Surface>
  )
}

function ApproveBids({ ev }: { ev: SourcingEvent }) {
  const approve = useStore((s) => s.approveBids)
  const [open, setOpen] = useState(false)
  const pending = responded(ev).filter((s) => !ev.approved[s])
  const ready = pending.filter((s) => !openCounters(ev, s).length)
  const [picked, setPicked] = useState<string[]>([])
  const chosen = picked.filter((s) => ready.includes(s))
  const go = () =>
    void approve(ev.id, chosen).then((n) => {
      if (!n) return
      setOpen(false)
      toast.success(n === 1 ? `${supplier(chosen[0]).shortName}'s bid is approved` : `${n} bids approved`, { description: "The new rates are live on their rate cards." })
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
            <DialogDescription className="sr-only">Pick the bids to approve.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 px-4 text-caption-1 text-faded">
            <span className="flex-1">Agency</span>
            <span className="text-right">A year at these rates, after VA</span>
          </div>
          <ul className="-mt-2 flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border scrollbar-thin">
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
                      <Change value={spend.baseline ? spend.proposed / spend.baseline - 1 : undefined} suffix=" vs today" />
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
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
  const counter = openCounters(ev, supplierId).at(-1)
  const approvedAt = ev.approved[supplierId]
  const locked = !!approvedAt || ev.status === "awarded"
  const [pay, setPay] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ev.lines.map((l) => {
        const v = bid?.lines[l.id] ?? activeCard(data.rateCards, supplierId, l.cityId, l.positionId)
        return [l.id, v ? v.proRate.toFixed(2) : ""]
      }),
    ),
  )
  const [markup, setMarkup] = useState(() => String(Math.round(bid?.markupPct ?? agencyValue(ev, data.rateCards, supplierId).markupPct)))
  const [va, setVa] = useState(() => String(offeredTerms(ev, supplierId).vaPct))
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const markets = marketsOf(ev, supplierId)
  const mine = ev.lines.filter((l) => markets.includes(l.cityId))
  const markupN = markup === "" ? NaN : Number(markup)
  const vaN = va === "" ? NaN : Number(va)

  const priced = markupN >= 0 ? mine.flatMap((l) => (Number(pay[l.id]) > 0 ? [{ line: l, pay: Number(pay[l.id]), bill: billFrom(Number(pay[l.id]), markupN) }] : [])) : []
  const billings = priced.reduce((sum, p) => sum + p.line.hours * (p.line.share[supplierId] ?? 0) * p.bill, 0)
  const today = spendOf(ev, supplierId, true).baseline
  const round = (bid?.round ?? 0) + 1
  const status = agencyStatus(ev, supplierId)

  const send = async () => {
    setBusy(true)
    const n = await submit(ev.id, Object.fromEntries(priced.map((p) => [p.line.id, p.pay])), markupN, vaN, note.trim() || undefined)
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
            Compass approved your bid on {formatDateFull(dateOf(approvedAt))}. These rates are live on your rate card.{" "}
            <Link href="/procurement?tab=rates" className="font-medium underline underline-offset-4">
              See your rate cards
            </Link>
          </Banner>
        ) : counter && !locked ? (
          <Banner tone="warning" icon={MessageSquareText}>
            Compass asks for {[counter.ask !== undefined && `a ${pct(counter.ask)} markup on every role`, counter.askVa !== undefined && `${pct(counter.askVa)} VA`].filter(Boolean).join(" and ")}.
            <button
              type="button"
              className="ml-2 font-semibold underline-offset-4 hover:underline"
              onClick={() => {
                if (counter.ask !== undefined) setMarkup(String(counter.ask))
                if (counter.askVa !== undefined) setVa(String(counter.askVa))
              }}
            >
              Accept
            </button>
            <span className="text-faded"> Then send round {round}.</span>
          </Banner>
        ) : null}
        <Surface elevated className="overflow-hidden" data-tour="agency-bid">
          <SurfaceHeader
            title={bid ? `Your bid, round ${bid.round}` : "Your bid"}
            description={bid ? `Sent ${formatTimestamp(bid.at)}` : `Due ${formatDateShort(ev.closesOn)}`}
            info="One markup goes on every role, and VA comes back at year end. Hours are Compass's estimate for the year. Leave a pay rate blank to skip a role."
            actions={
              <span className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-body-3 font-medium">
                  Markup on every role
                  <NumberField suffix="%" value={markup} disabled={locked} invalid={!locked && !(markupN >= 0)} label="Markup on every role" onChange={setMarkup} />
                </label>
                <label className="flex items-center gap-2 text-body-3 font-medium">
                  VA
                  <NumberField suffix="%" value={va} disabled={locked} invalid={!locked && !(vaN >= 0 && vaN <= 50)} label="VA" onChange={setVa} />
                </label>
              </span>
            }
          />
          <div className="overflow-x-auto px-2 pt-3 scrollbar-thin">
            <table className="w-full min-w-[560px] text-body-3">
              <thead>
                <tr className="text-caption-1 text-faded">
                  <th className="px-3 pb-2 text-left font-medium">Role</th>
                  <th className="px-3 pb-2 text-right font-medium">Hours a year</th>
                  <th className="px-3 pb-2 text-right font-medium">Today</th>
                  <th className="px-3 pb-2 text-right font-medium">Pay rate</th>
                  <th className="px-3 pb-2 text-right font-medium">Bill rate</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((l, i) => {
                  const p = Number(pay[l.id])
                  const bill = p > 0 && markupN >= 0 ? billFrom(p, markupN) : undefined
                  const was = l.baseline[supplierId]
                  const heading = ev.cityIds.length > 1 && mine[i - 1]?.cityId !== l.cityId
                  return (
                    <Fragment key={l.id}>
                      {heading && (
                        <tr className="border-t border-border/70 bg-page-faded/60">
                          <td colSpan={5} className="px-3 py-1.5 text-caption-1 font-semibold">
                            {city(l.cityId).name}, {city(l.cityId).state}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-border/70">
                        <td className="px-3 py-2 font-medium">{position(l.positionId).name}</td>
                        <td className="px-3 py-2 text-right text-faded tabular">{l.hours.toLocaleString("en-US")}</td>
                        <td className="px-3 py-2 text-right text-faded tabular">{was ? money(was) : "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <NumberField prefix="$" value={pay[l.id] ?? ""} disabled={locked} label={`${lineName(ev, l.id)} pay rate`} onChange={(v) => setPay((f) => ({ ...f, [l.id]: v }))} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="flex flex-col items-end">
                            <span className="font-semibold tabular">{bill ? money(bill) : "—"}</span>
                            {bill && was ? <Change value={bill / was - 1} /> : null}
                          </span>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!locked && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border bg-page-faded/60 px-5 py-3">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to Compass (optional)" className="h-9 min-w-56 flex-1 rounded-lg bg-card" />
              <Button className="h-9" disabled={busy || !priced.length || !(vaN >= 0 && vaN <= 50)} onClick={send} data-tour="submit-bid">
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
                {priced.length} of {mine.length}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faded">{todayISO() > ev.closesOn ? "Bids closed" : "Bids due"}</dt>
              <dd className="font-medium">{formatDateFull(ev.closesOn)}</dd>
            </div>
          </dl>
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

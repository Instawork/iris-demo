"use client"

import Link from "next/link"
import { Check, CircleCheck, FileSearch, MessageSquareText } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { InfoTip } from "@/components/common/info-tip"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { StageBadge, StageTrack, agencyStatus, moneyYear, termLabel } from "@/components/procurement/sourcing-bits"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatDateShort, formatTimestamp } from "@/lib/dates"
import { billFrom, money, pct, round2 } from "@/lib/format"
import { PROGRAM, position, supplier } from "@/lib/reference"
import { activeCard, bestOn, bidsOf, latestBid, marketName, openCounters, responded, spendOf } from "@/lib/sourcing"
import { useStore } from "@/lib/store"
import type { SourcingEvent, SourcingLine, SourcingMessage } from "@/lib/types"
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
      <div className="flex flex-col gap-1.5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption-1 text-faded">{ev.number}</span>
          <StageBadge ev={ev} size="sm" />
          <StatusBadge tone="neutral" size="sm">
            {ev.category}
          </StatusBadge>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-featured-1 font-semibold">{ev.title}</h1>
          {!isAgency && ev.status === "open" && <ApproveAll ev={ev} />}
        </div>
        <p className="text-body-3 text-faded">
          {marketName(ev)} · Term {termLabel(ev)} · {ev.lines.length} roles · Opened by {ev.createdBy}
        </p>
      </div>
      <Surface elevated className="px-5 py-4">
        <StageTrack ev={ev} />
      </Surface>
      {isAgency ? <AgencyBid ev={ev} supplierId={ws.supplierId!} /> : <CompassView ev={ev} />}
    </>
  )
}

/* --------------------------------- Compass -------------------------------- */

function CompassView({ ev }: { ev: SourcingEvent }) {
  const spend = spendOf(ev)
  const bidders = responded(ev).length
  return (
    <>
      <Surface elevated className="grid divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Kpi label="Today's rates" value={moneyYear(spend.baseline)} sub="A year, at today's shares" />
        <Kpi label="Latest bids" value={bidders ? moneyYear(spend.proposed) : "—"} sub={`${bidders} of ${ev.invited.length} agencies in`} />
        <Kpi
          label="Savings"
          value={bidders ? `${spend.savings >= 0 ? "−" : "+"}${pct(Math.abs(spend.savingsPct), 1)}` : "—"}
          sub={bidders ? `${moneyYear(Math.abs(spend.savings))} a year` : "Waiting on bids"}
          tone={spend.savings > 0 ? "positive" : undefined}
        />
        <Kpi
          label="Lowest bid on every role"
          info="If each role's hours went to its lowest bidder. Iris already sends shifts to the lowest rate first."
          value={bidders ? moneyYear(spend.lowest) : "—"}
          sub={bidders && spend.baseline ? `${pct((spend.baseline - spend.lowest) / spend.baseline, 1)} below today` : undefined}
        />
      </Surface>
      <BidMatrix ev={ev} />
      <Thread ev={ev} />
    </>
  )
}

function Kpi({ label, value, sub, info, tone }: { label: string; value: string; sub?: string; info?: string; tone?: "positive" }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="flex items-center gap-1.5 text-body-3 text-faded">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </span>
      <span className={cn("text-[24px] leading-8 font-semibold tracking-[-0.03em] tabular", tone === "positive" && "text-positive-fg")}>{value}</span>
      {sub && <span className="text-caption-1 text-faded">{sub}</span>}
    </div>
  )
}

const change = (to: number, from?: number) => (from ? to / from - 1 : undefined)

function Delta({ value }: { value?: number }) {
  if (value === undefined || Math.abs(value) < 0.0005) return <span className="text-caption-1 text-faded">Same as today</span>
  return (
    <span className={cn("text-caption-1 tabular", value < 0 ? "text-positive-fg" : "text-critical-fg")}>
      {value < 0 ? "−" : "+"}
      {pct(Math.abs(value), 1)} vs today
    </span>
  )
}

/** Every role down the side, every agency across the top, the latest bid in each cell and the lowest one marked. */
function BidMatrix({ ev }: { ev: SourcingEvent }) {
  const approve = useStore((s) => s.approveBids)
  const cols = ev.invited
  const grid = `minmax(150px,1.3fr) 92px repeat(${cols.length}, minmax(124px,1fr))`
  return (
    <Surface elevated className="overflow-hidden" data-tour="bid-matrix">
      <SurfaceHeader
        title="Bids"
        info="Bill rate per hour from each agency's latest round. The lowest bid on each role is marked. Click a bid to counter it."
        actions={ev.status === "open" && <span className="text-caption-1 text-faded">Click a bid to counter</span>}
      />
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid items-end gap-3 border-y border-border bg-page-faded px-4 py-2.5" style={{ gridTemplateColumns: grid }}>
            <span className="text-caption-1 font-medium text-faded">Role</span>
            <span className="text-right text-caption-1 font-medium text-faded">Hours a year</span>
            {cols.map((s) => {
              const st = agencyStatus(ev, s)
              return (
                <span key={s} className="flex flex-col items-end gap-1">
                  <span className="flex items-center gap-1.5">
                    <SupplierLogo supplierId={s} size="xs" />
                    <span className="text-body-3 font-semibold">{supplier(s).shortName}</span>
                  </span>
                  <StatusBadge tone={st.tone} size="sm">
                    {st.label}
                  </StatusBadge>
                </span>
              )
            })}
          </div>
          {ev.lines.map((line) => {
            const best = bestOn(ev, line.id)
            return (
              <div key={line.id} className="grid items-center gap-3 border-b border-border/70 px-4 py-2" style={{ gridTemplateColumns: grid }}>
                <span className="font-semibold">{position(line.positionId).name}</span>
                <span className="text-right text-faded tabular">{line.hours.toLocaleString("en-US")}</span>
                {cols.map((s) => (
                  <BidCell key={s} ev={ev} line={line} supplierId={s} best={best?.supplierId === s && responded(ev).length > 1} />
                ))}
              </div>
            )
          })}
          <div className="grid items-start gap-3 bg-page-faded/60 px-4 py-3" style={{ gridTemplateColumns: grid }}>
            <span className="flex flex-col">
              <span className="font-semibold">A year</span>
              <span className="text-caption-1 text-faded">At each agency&apos;s share</span>
            </span>
            <span />
            {cols.map((s) => {
              const spend = spendOf(ev, s)
              const bid = latestBid(ev, s)
              const waiting = openCounters(ev, s).length > 0
              return (
                <span key={s} className="flex flex-col items-end gap-1.5">
                  <span className="font-semibold tabular">{bid ? moneyYear(spend.proposed) : "—"}</span>
                  {bid && <Delta value={change(spend.proposed, spend.baseline)} />}
                  {ev.approved[s] ? (
                    <span className="inline-flex h-7 items-center gap-1 text-caption-1 font-medium text-positive-fg">
                      <CircleCheck className="size-3.5" /> Live on rate card
                    </span>
                  ) : bid && ev.status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-md text-caption-1"
                      disabled={waiting}
                      title={waiting ? "Waiting on an answer to your counter" : undefined}
                      data-tour="approve-bid"
                      onClick={() =>
                        void approve(ev.id, [s]).then((n) => n && toast.success(`${supplier(s).shortName}'s rates are approved`, { description: `They're live on its ${marketName(ev)} rate card.` }))
                      }
                    >
                      <Check className="size-3.5" /> Approve
                    </Button>
                  ) : null}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </Surface>
  )
}

function BidCell({ ev, line, supplierId, best }: { ev: SourcingEvent; line: SourcingLine; supplierId: string; best: boolean }) {
  const counter = useStore((s) => s.counterBid)
  const rounds = bidsOf(ev, supplierId).filter((b, i, all) => b.lines[line.id] && b.lines[line.id].billRate !== all[i - 1]?.lines[line.id]?.billRate)
  const bid = latestBid(ev, supplierId)?.lines[line.id]
  const open = openCounters(ev, supplierId).find((m) => m.lineId === line.id)
  const field = bestOn(ev, line.id)
  const suggested = bid ? round2(field && field.supplierId !== supplierId && field.billRate < bid.billRate ? field.billRate : bid.billRate * 0.97) : 0
  const [ask, setAsk] = useState(suggested.toFixed(2))
  const [pop, setPop] = useState(false)
  if (!bid) return <span className="text-right text-caption-1 text-subtle">{line.baseline[supplierId] ? "No bid yet" : "Doesn't staff"}</span>
  const locked = !!ev.approved[supplierId] || ev.status === "awarded"
  const askN = Number(ask)
  const send = () =>
    void counter(ev.id, supplierId, line.id, askN).then((ok) => {
      if (!ok) return
      setPop(false)
      toast.success(`Counter sent to ${supplier(supplierId).shortName}`, { description: `${position(line.positionId).name} at ${money(askN)}/hr` })
    })
  return (
    <Popover open={pop} onOpenChange={(o) => (setPop(o), o && setAsk(suggested.toFixed(2)))}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tour="bid-cell"
          data-supplier={supplierId}
          data-position={line.positionId}
          className={cn(
            "flex flex-col items-end rounded-lg px-2 py-1 text-right ring-1 ring-inset transition-colors",
            best ? "bg-positive-faded ring-positive-border/80" : "ring-transparent hover:bg-hover/70 hover:ring-border",
            open && "ring-warning-border bg-warning-faded",
          )}
        >
          <span className="flex items-center gap-1 font-semibold tabular">
            {best && <span className="text-caption-2 font-semibold text-positive-fg">Lowest</span>}
            {money(bid.billRate)}
          </span>
          {open ? <span className="text-caption-1 text-warning-fg tabular">Asked {money(open.ask!)}</span> : <Delta value={change(bid.billRate, line.baseline[supplierId])} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3">
        <div className="flex items-center gap-2">
          <SupplierLogo supplierId={supplierId} size="sm" />
          <span className="flex flex-col">
            <span className="text-body-3 font-semibold">
              {supplier(supplierId).shortName} · {position(line.positionId).name}
            </span>
            <span className="text-caption-1 text-faded tabular">
              Pay {money(bid.proRate)} · markup {bid.markupPct}%
            </span>
          </span>
        </div>
        <ol className="flex flex-col gap-1 rounded-lg bg-page-faded px-3 py-2 text-body-3 tabular">
          {line.baseline[supplierId] && (
            <li className="flex justify-between text-faded">
              <span>Today</span>
              <span>{money(line.baseline[supplierId])}</span>
            </li>
          )}
          {rounds.map((r) => (
            <li key={r.round} className="flex justify-between">
              <span>Round {r.round}</span>
              <span className={r === rounds.at(-1) ? "font-semibold" : "text-faded"}>{money(r.lines[line.id].billRate)}</span>
            </li>
          ))}
          {field && field.supplierId !== supplierId && (
            <li className="flex justify-between border-t border-border/70 pt-1 text-faded">
              <span>Lowest bid ({supplier(field.supplierId).shortName})</span>
              <span>{money(field.billRate)}</span>
            </li>
          )}
        </ol>
        {locked ? (
          <p className="text-caption-1 text-faded">Approved. This rate is on the agency&apos;s rate card.</p>
        ) : open ? (
          <p className="text-caption-1 text-faded">
            You asked for {money(open.ask!)}. Waiting on {supplier(supplierId).contactName.split(" ")[0]}.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-caption-1 font-medium text-faded">Ask for</span>
              <span className="relative">
                <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-body-3 text-faded">$</span>
                <input
                  inputMode="decimal"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value.replace(/[^\d.]/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && askN > 0 && askN < bid.billRate && send()}
                  className="h-9 w-full rounded-lg border border-input bg-card pr-2 pl-6 text-body-3 font-semibold tabular outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                />
              </span>
            </label>
            <Button className="h-9" disabled={!(askN > 0 && askN < bid.billRate)} onClick={send} data-tour="send-counter">
              Counter
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ApproveAll({ ev }: { ev: SourcingEvent }) {
  const approve = useStore((s) => s.approveBids)
  const [open, setOpen] = useState(false)
  const ready = responded(ev).filter((s) => !ev.approved[s])
  const waiting = ready.filter((s) => openCounters(ev, s).length)
  const go = ready.filter((s) => !waiting.includes(s))
  const roles = ev.lines.length
  return (
    <>
      <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" disabled={!go.length} onClick={() => setOpen(true)} data-tour="approve-all">
        <Check className="size-4" /> Approve bids
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {go.length === 1 ? `${supplier(go[0]).shortName}'s bid` : `${go.length} bids`}</DialogTitle>
            <DialogDescription>
              Their latest prices on {roles} roles go live on their {marketName(ev)} rate cards today. New shifts price at them, and the change is in the rate log.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {go.map((s) => {
              const spend = spendOf(ev, s)
              return (
                <li key={s} className="flex items-center gap-2.5 px-3 py-2">
                  <SupplierLogo supplierId={s} size="sm" />
                  <span className="flex-1 font-medium">{supplier(s).name}</span>
                  <span className="flex flex-col items-end">
                    <span className="text-body-3 font-semibold tabular">{moneyYear(spend.proposed)}</span>
                    <Delta value={change(spend.proposed, spend.baseline)} />
                  </span>
                </li>
              )
            })}
          </ul>
          {waiting.length > 0 && (
            <p className="text-caption-1 text-faded">
              {waiting.map((s) => supplier(s).shortName).join(", ")} still owes you an answer on a counter, so it waits.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void approve(ev.id, go).then((n) => {
                  if (!n) return
                  setOpen(false)
                  toast.success(`${n} ${n === 1 ? "bid" : "bids"} approved`, { description: `The new rates are live on the ${marketName(ev)} rate cards.` })
                })
              }
            >
              Approve and publish rates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Thread({ ev, supplierId }: { ev: SourcingEvent; supplierId?: string }) {
  const items = ev.messages.filter((m) => !supplierId || m.supplierId === supplierId)
  const rounds = ev.bids.filter((b) => (!supplierId || b.supplierId === supplierId) && b.round === 1)
  const feed: { at: string; key: string; node: React.ReactNode }[] = [
    ...items.map((m) => ({ at: m.at, key: m.id, node: <Message m={m} ev={ev} /> })),
    ...rounds.map((b) => ({
      at: b.at,
      key: `${b.supplierId}-bid`,
      node: (
        <Entry who={supplier(b.supplierId).contactName} org={supplier(b.supplierId).shortName} supplierId={b.supplierId} at={b.at}>
          Sent a bid on {Object.keys(b.lines).length} roles.
        </Entry>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <Surface elevated>
      <SurfaceHeader title="Negotiation" description={supplierId ? "Between you and Compass" : "Every counter and answer, newest first"} />
      {feed.length ? (
        <ol className="flex flex-col px-4 pb-3">{feed.map((f) => <li key={f.key}>{f.node}</li>)}</ol>
      ) : (
        <div className="px-4 pb-4">
          <EmptyState icon={MessageSquareText} title="Nothing yet" description="Bids and counters show up here." compact />
        </div>
      )}
    </Surface>
  )
}

function Message({ m, ev }: { m: SourcingMessage; ev: SourcingEvent }) {
  const fromCompass = m.from === "compass"
  const role = m.lineId ? position(ev.lines.find((l) => l.id === m.lineId)!.positionId).name : undefined
  return (
    <Entry who={m.by} org={fromCompass ? `Compass to ${supplier(m.supplierId).shortName}` : supplier(m.supplierId).shortName} supplierId={fromCompass ? undefined : m.supplierId} at={m.at}>
      <span className="flex flex-wrap items-center gap-1.5">
        {role && (
          <StatusBadge tone="neutral" size="sm">
            {role}
          </StatusBadge>
        )}
        {m.ask !== undefined && (
          <StatusBadge tone={m.open ? "warning" : "neutral"} size="sm">
            Asked {money(m.ask)}
            {m.open ? " · waiting" : ""}
          </StatusBadge>
        )}
      </span>
      <span>{m.text}</span>
    </Entry>
  )
}

function Entry({ who, org, supplierId, at, children }: { who: string; org: string; supplierId?: string; at: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border/60 py-3 last:border-0">
      {supplierId ? (
        <SupplierLogo supplierId={supplierId} size="sm" />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-foreground text-[10px] font-semibold text-background">CG</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-body-3">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{who}</span>
          <span className="text-caption-1 text-faded">{org}</span>
          <span className="ml-auto text-caption-1 text-faded tabular">{formatTimestamp(at)}</span>
        </span>
        {children}
      </div>
    </div>
  )
}

/* --------------------------------- Agency --------------------------------- */

function AgencyBid({ ev, supplierId }: { ev: SourcingEvent; supplierId: string }) {
  const data = useData()
  const submit = useStore((s) => s.submitBid)
  const bid = latestBid(ev, supplierId)
  const counters = openCounters(ev, supplierId)
  const approvedAt = ev.approved[supplierId]
  const locked = !!approvedAt || ev.status === "awarded"
  const start = () =>
    Object.fromEntries(
      ev.lines.map((l) => {
        const b = bid?.lines[l.id]
        const card = activeCard(data.rateCards, supplierId, ev.cityId, l.positionId)
        const v = b ?? card
        return [l.id, { pay: v ? v.proRate.toFixed(2) : "", markup: v ? String(v.markupPct) : "" }]
      }),
    )
  const [form, setForm] = useState<Record<string, { pay: string; markup: string }>>(start)
  const [busy, setBusy] = useState(false)
  const set = (lineId: string, patch: Partial<{ pay: string; markup: string }>) => setForm((f) => ({ ...f, [lineId]: { ...f[lineId], ...patch } }))

  const priced = ev.lines.flatMap((l) => {
    const pay = Number(form[l.id]?.pay)
    const markup = Number(form[l.id]?.markup)
    return pay > 0 && form[l.id]?.markup !== "" && markup >= 0 ? [{ line: l, pay, markup, bill: billFrom(pay, markup) }] : []
  })
  const over = priced.filter((p) => p.markup > PROGRAM.maxMarkupPct)
  const billings = priced.reduce((sum, p) => sum + p.line.hours * (p.line.share[supplierId] ?? 0) * p.bill, 0)
  const round = (bid?.round ?? 0) + 1

  const send = async () => {
    setBusy(true)
    const n = await submit(ev.id, Object.fromEntries(priced.map((p) => [p.line.id, { proRate: p.pay, markupPct: p.markup }])))
    setBusy(false)
    if (n) toast.success(n === 1 ? "Bid sent to Compass" : `Round ${n} sent to Compass`, { description: "You'll hear back here." })
  }

  return (
    <>
      {approvedAt ? (
        <Surface className="flex items-center gap-3 border-positive-border/80 bg-positive-faded px-4 py-3 text-body-3">
          <CircleCheck className="size-4 text-positive-fg" />
          <span>
            Compass approved your bid on {formatTimestamp(approvedAt)}. These rates are live on your rate card.{" "}
            <Link href="/procurement?tab=rates" className="font-medium underline underline-offset-4">
              See your rate cards
            </Link>
          </span>
        </Surface>
      ) : counters.length ? (
        <Surface className="flex items-center gap-3 border-warning-border/80 bg-warning-faded px-4 py-3 text-body-3">
          <MessageSquareText className="size-4 text-warning-fg" />
          <span>
            Compass countered {counters.length === 1 ? "one of your rates" : `${counters.length} of your rates`}. Accept the ask or send your best, then send round {round}.
          </span>
        </Surface>
      ) : null}
      <Surface elevated className="overflow-hidden" data-tour="agency-bid">
        <SurfaceHeader
          title={bid ? `Your bid · round ${bid.round}` : "Your bid"}
          info="Hours are Compass's estimate for the year. Leave a role blank to skip it."
          description={bid ? `Sent ${formatTimestamp(bid.at)}` : `Due ${formatDateShort(ev.closesOn)}`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-body-3">
            <thead className="border-y border-border bg-page-faded text-caption-1 text-faded">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Role</th>
                <th className="px-3 py-2.5 text-right font-medium">Hours a year</th>
                <th className="px-3 py-2.5 text-right font-medium">Today</th>
                <th className="px-3 py-2.5 text-right font-medium">Pay rate</th>
                <th className="px-3 py-2.5 text-right font-medium">Markup</th>
                <th className="px-4 py-2.5 text-right font-medium">Bill rate</th>
              </tr>
            </thead>
            <tbody>
              {ev.lines.map((l) => {
                const f = form[l.id]
                const pay = Number(f?.pay)
                const markup = Number(f?.markup)
                const bill = pay > 0 && f?.markup !== "" ? billFrom(pay, markup) : undefined
                const ask = counters.find((m) => m.lineId === l.id)
                return (
                  <tr key={l.id} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-2 font-semibold">{position(l.positionId).name}</td>
                    <td className="px-3 py-2 text-right text-faded tabular">{l.hours.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2 text-right text-faded tabular">{l.baseline[supplierId] ? money(l.baseline[supplierId]) : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <NumberField prefix="$" value={f?.pay ?? ""} disabled={locked} onChange={(v) => set(l.id, { pay: v })} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <NumberField suffix="%" value={f?.markup ?? ""} disabled={locked} invalid={markup > PROGRAM.maxMarkupPct} onChange={(v) => set(l.id, { markup: v })} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="flex flex-col items-end">
                        <span className="font-semibold tabular">{bill ? money(bill) : "—"}</span>
                        {ask && !locked ? (
                          <button
                            type="button"
                            className="text-caption-1 font-medium text-warning-fg underline-offset-4 hover:underline"
                            onClick={() => pay > 0 && set(l.id, { markup: String(round2((ask.ask! / pay - 1) * 100)) })}
                          >
                            Compass asks {money(ask.ask!)} · Accept
                          </button>
                        ) : bill ? (
                          <Delta value={change(bill, l.baseline[supplierId])} />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!locked && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-page-faded/60 px-4 py-3">
            <span className="text-body-3 text-faded">
              {over.length ? (
                <span className="text-critical-fg">Markup is capped at {PROGRAM.maxMarkupPct}% on this program.</span>
              ) : (
                <>
                  About <span className="font-semibold text-foreground tabular">{moneyYear(billings)}</span> a year at your share of the hours
                </>
              )}
            </span>
            <Button disabled={busy || !priced.length || over.length > 0} onClick={send} data-tour="submit-bid">
              {bid ? `Send round ${round}` : "Submit bid"}
            </Button>
          </div>
        )}
      </Surface>
      <Thread ev={ev} supplierId={supplierId} />
    </>
  )
}

function NumberField({ value, onChange, prefix, suffix, disabled, invalid }: { value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; disabled?: boolean; invalid?: boolean }) {
  return (
    <span className="relative ml-auto inline-block w-24">
      {prefix && <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-body-3 text-faded">{prefix}</span>}
      <input
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        className={cn(
          "h-8 w-full rounded-md border border-input bg-card text-right text-body-3 font-medium tabular outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:bg-transparent disabled:border-transparent",
          prefix ? "pr-2.5 pl-6" : "pr-7 pl-2.5",
          invalid && "border-critical-border text-critical-fg",
        )}
      />
      {suffix && <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-body-3 text-faded">{suffix}</span>}
    </span>
  )
}

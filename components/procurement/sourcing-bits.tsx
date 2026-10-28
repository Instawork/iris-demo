"use client"

import { Check } from "lucide-react"

import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { formatDateFull, formatDateShort, todayISO } from "@/lib/dates"
import type { Benchmark } from "@/lib/market"
import { STAGE_LABEL, latestBid, openCounters, stageOf, type Stage } from "@/lib/sourcing"
import type { SourcingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

const STAGE_TONE: Record<Stage, Tone> = { collecting: "primary", negotiating: "warning", awarded: "positive" }

export function StageBadge({ ev, size = "md" }: { ev: SourcingEvent; size?: "sm" | "md" }) {
  const stage = stageOf(ev, todayISO())
  return (
    <StatusBadge tone={STAGE_TONE[stage]} size={size} dot>
      {STAGE_LABEL[stage]}
    </StatusBadge>
  )
}

/** Where an agency stands on an event, in a word or two. */
export function agencyStatus(ev: SourcingEvent, supplierId: string): { label: string; tone: Tone } {
  if (ev.approved[supplierId]) return { label: "Approved", tone: "positive" }
  const bid = latestBid(ev, supplierId)
  if (!bid) return { label: ev.status === "awarded" ? "No bid" : "Invited", tone: "neutral" }
  if (openCounters(ev, supplierId).length) return { label: "Countered", tone: "warning" }
  return { label: bid.round > 1 ? `Round ${bid.round}` : "Bid in", tone: "primary" }
}

interface Step {
  label: string
  detail: string
  done: boolean
}

/** The event's path from invitation to rate cards, with when each step happened or is due. */
export function stepsOf(ev: SourcingEvent): Step[] {
  const today = todayISO()
  const stage = stageOf(ev, today)
  const awarded = ev.awardedAt?.slice(0, 10)
  const lastWord = [...ev.messages.map((m) => m.at), ...ev.bids.map((b) => b.at)].sort().at(-1)?.slice(0, 10)
  const earlyClose = stage !== "collecting" && today <= ev.closesOn
  const lastFirstBid = ev.bids.filter((b) => b.round === 1).map((b) => b.at).sort().at(-1)?.slice(0, 10)
  const approved = Object.keys(ev.approved).length
  const bidders = ev.invited.filter((s) => latestBid(ev, s)).length
  return [
    { label: "Agencies invited", detail: formatDateFull(ev.openedAt.slice(0, 10)), done: true },
    {
      label: earlyClose ? "All bids in" : today > ev.closesOn ? "Bids closed" : "Bids due",
      detail: formatDateFull(earlyClose && lastFirstBid ? lastFirstBid : ev.closesOn),
      done: stage !== "collecting",
    },
    { label: "Negotiation", detail: lastWord && stage !== "collecting" ? `Last word ${formatDateShort(lastWord)}` : "Counter any bid, line by line", done: stage === "awarded" },
    {
      label: "Bids approved",
      detail: awarded ? formatDateFull(awarded) : approved ? `${approved} of ${bidders} approved` : "Approve each agency when it's ready",
      done: stage === "awarded",
    },
    { label: "Live on rate cards", detail: awarded ? `From ${formatDateShort(awarded)}` : `Term starts ${formatDateShort(ev.termStart)}`, done: stage === "awarded" },
  ]
}

/** The steps as a vertical list, for the side of a page. */
export function Timeline({ ev }: { ev: SourcingEvent }) {
  const steps = stepsOf(ev)
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className={cn("absolute top-5 bottom-0 left-[9px] w-px", s.done ? "bg-positive/50" : "bg-border")} />}
          <span
            className={cn(
              "relative z-[1] mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
              s.done ? "bg-positive text-white" : i === current ? "bg-card text-foreground ring-[1.5px] ring-foreground" : "bg-card text-subtle ring-1 ring-border-strong",
            )}
          >
            {s.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className={cn("text-body-3 font-medium", !s.done && i !== current && "text-faded")}>{s.label}</span>
            <span className="text-caption-1 text-faded">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export const termLabel = (ev: SourcingEvent) => `${formatDateFull(ev.termStart)} – ${formatDateFull(ev.termEnd)}`

/** A whole-dollar amount, short: $1.24M, $86K. */
export function moneyYear(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

export interface Mark {
  value: number
  kind: "best" | "today" | "bid"
}

/**
 * A rate against the market: the faint line is the full range, the darker band the middle half, the tick the median.
 * A solid dot is the best bid, a ring is what Compass pays today, small dots are other bids.
 */
export function BenchmarkBar({ b, marks, className }: { b: Benchmark; marks: Mark[]; className?: string }) {
  const lo = Math.min(b.low, ...marks.map((m) => m.value)) * 0.99
  const hi = Math.max(b.high, ...marks.map((m) => m.value)) * 1.01
  const at = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const order = { bid: 0, today: 1, best: 2 }
  return (
    <span className={cn("relative block h-4", className)} aria-hidden>
      <span className="absolute top-1/2 h-px -translate-y-1/2 bg-foreground/15" style={{ left: at(b.low), right: `calc(100% - ${at(b.high)})` }} />
      <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/12" style={{ left: at(b.p25), right: `calc(100% - ${at(b.p75)})` }} />
      <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/55" style={{ left: at(b.median) }} />
      {[...marks]
        .sort((x, y) => order[x.kind] - order[y.kind])
        .map((m, i) => (
          <span
            key={`${m.kind}-${i}`}
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
              m.kind === "best" && cn("size-2.5 ring-2 ring-card", m.value <= b.median ? "bg-positive" : "bg-warning"),
              m.kind === "today" && "size-2.5 bg-card ring-[1.5px] ring-foreground/70",
              m.kind === "bid" && "size-1.5 bg-foreground/35",
            )}
            style={{ left: at(m.value) }}
          />
        ))}
    </span>
  )
}

/** The legend for BenchmarkBar, for the foot of a table. */
export function BenchmarkLegend({ today = "Today", best = "Best bid", bids }: { today?: string; best?: string; bids?: string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption-1 text-faded">
      {best && (
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-positive" /> {best}
        </span>
      )}
      {bids && (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-foreground/35" /> {bids}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full ring-[1.5px] ring-foreground/70" /> {today}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-4 rounded-full bg-foreground/15" /> Middle half of the market
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-px bg-foreground/55" /> Median
      </span>
    </span>
  )
}

/** "3.1% under" in green, "2.0% over" in amber, "At market" when it's within a tenth of a percent. */
export function VsMarket({ value, className }: { value?: number; className?: string }) {
  if (value === undefined) return <span className={cn("text-faded", className)}>—</span>
  if (Math.abs(value) < 0.001) return <span className={cn("text-faded", className)}>At market</span>
  return (
    <span className={cn("tabular", value < 0 ? "text-positive-fg" : value > 0.05 ? "text-critical-fg" : "text-warning-fg", className)}>
      {(Math.abs(value) * 100).toFixed(1)}% {value < 0 ? "under" : "over"}
    </span>
  )
}

/** A change against today's rate: green when it's lower, quiet when it's flat, and only loud when it's well up. */
export function Change({ value, suffix = "" }: { value?: number; suffix?: string }) {
  if (value === undefined || Math.abs(value) < 0.0005) return null
  return (
    <span className={cn("text-caption-1 tabular", value < 0 ? "text-positive-fg" : value > 0.03 ? "text-critical-fg" : "text-faded")}>
      {value < 0 ? "−" : "+"}
      {(Math.abs(value) * 100).toFixed(1)}%{suffix}
    </span>
  )
}

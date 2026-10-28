"use client"

import { Check } from "lucide-react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { Tip } from "@/components/common/info-tip"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { formatDateFull, formatDateShort, todayISO } from "@/lib/dates"
import { STAGE_LABEL, latestBid, openCounters, stageOf, type Stage } from "@/lib/sourcing"
import { supplier } from "@/lib/reference"
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

/** Where an agency stands on an event, in its own words. */
export function agencyStatus(ev: SourcingEvent, supplierId: string): { label: string; tone: Tone } {
  if (ev.approved[supplierId]) return { label: "Approved", tone: "positive" }
  const bid = latestBid(ev, supplierId)
  if (!bid) return { label: ev.status === "awarded" ? "No bid" : "Invited", tone: "neutral" }
  if (openCounters(ev, supplierId).length) return { label: "Countered", tone: "warning" }
  return { label: bid.round > 1 ? `Round ${bid.round}` : "Bid in", tone: "primary" }
}

/** The event's path from invitation to rate cards, with the date each step happened or is due. */
export function StageTrack({ ev }: { ev: SourcingEvent }) {
  const today = todayISO()
  const stage = stageOf(ev, today)
  const lastWord = ev.messages.at(-1)?.at ?? ev.bids.at(-1)?.at
  const steps = [
    { label: "Invited", date: formatDateShort(ev.openedAt.slice(0, 10)), done: true },
    { label: today > ev.closesOn ? "Bids closed" : "Bids due", date: formatDateShort(ev.closesOn), done: stage !== "collecting" },
    { label: "Negotiation", date: lastWord && stage !== "collecting" ? `Last word ${formatDateShort(lastWord.slice(0, 10))}` : "Line by line", done: stage === "awarded" },
    { label: "Approved", date: ev.awardedAt ? formatDateShort(ev.awardedAt.slice(0, 10)) : "Each agency", done: stage === "awarded" },
    { label: "On rate cards", date: ev.awardedAt ? `From ${formatDateShort(ev.awardedAt.slice(0, 10))}` : `Term from ${formatDateShort(ev.termStart)}`, done: stage === "awarded" },
  ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="grid grid-cols-5 gap-2">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-caption-2 font-semibold ring-1 ring-inset",
                s.done ? "bg-positive text-white ring-positive" : i === current ? "bg-card text-foreground ring-foreground/60" : "bg-card text-subtle ring-border-strong",
              )}
            >
              {s.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            {i < steps.length - 1 && <span className={cn("h-px flex-1", s.done ? "bg-positive/60" : "bg-border-strong/70")} />}
          </span>
          <span className="flex flex-col">
            <span className={cn("text-body-3 font-semibold", !s.done && i !== current && "text-faded")}>{s.label}</span>
            <span className="text-caption-1 text-faded">{s.date}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Invited agencies as a row of logos, faded until they bid. */
export function Responders({ ev }: { ev: SourcingEvent }) {
  const bid = ev.invited.filter((s) => latestBid(ev, s))
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-1.5">
        {ev.invited.map((s) => (
          <Tip key={s} content={`${supplier(s).shortName}: ${agencyStatus(ev, s).label}`}>
            <span className={cn("rounded-[7px] ring-2 ring-card", !latestBid(ev, s) && "opacity-35 grayscale")}>
              <SupplierLogo supplierId={s} size="xs" />
            </span>
          </Tip>
        ))}
      </span>
      <span className="text-caption-1 text-faded tabular">
        {bid.length} of {ev.invited.length}
      </span>
    </span>
  )
}

export const termLabel = (ev: SourcingEvent) => `${formatDateFull(ev.termStart)} – ${formatDateFull(ev.termEnd)}`

/** A whole-dollar amount a year, short: $1.24M, $86K. */
export function moneyYear(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

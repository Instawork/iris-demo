"use client"

import { cn } from "@/lib/utils"

/**
 * Every $100 Compass pays an agency, split three ways: the worker's pay, the agency's markup, and the VA that comes back
 * to Compass. It's the whole renewal in one picture: more green is better.
 */

export const PARTS = [
  { key: "worker", label: "To the worker", swatch: "bg-positive" },
  { key: "agency", label: "Agency keeps", swatch: "bg-border-strong" },
  { key: "back", label: "Back to you", swatch: "bg-brand" },
] as const

export type Split = { worker: number; agency: number; back: number }

/** A share of $100, in whole dollars. */
export const of100 = (n: number) => `$${Math.round(n * 100)}`

/** The three parts in whole dollars that still add up to $100. */
export function hundred(split: Split): Record<keyof Split, string> {
  const worker = Math.round(split.worker * 100)
  const back = Math.round(split.back * 100)
  return { worker: `$${worker}`, agency: `$${100 - worker - back}`, back: `$${back}` }
}

export const SPLIT_INFO = "Across all of the agency's roles and markets, weighted by the hours you buy from it: its total worker pay and VA as a share of its total bill."

export function DollarBar({ split, className }: { split: Split; className?: string }) {
  const parts = hundred(split)
  return (
    <span className={cn("flex h-3 w-full overflow-hidden rounded-full bg-muted", className)} aria-label={PARTS.map((p) => `${p.label} ${parts[p.key]}`).join(", ")}>
      {PARTS.map((p) => (
        <span key={p.key} className={cn("h-full transition-[width] duration-700 ease-out not-last:border-r-2 not-last:border-card", p.swatch)} style={{ width: `${split[p.key] * 100}%` }} />
      ))}
    </span>
  )
}

export function DollarLegend({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-caption-1 text-faded", className)}>
      {PARTS.map((p) => (
        <span key={p.key} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", p.swatch)} />
          {p.label}
        </span>
      ))}
    </span>
  )
}

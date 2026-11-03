"use client"

import { cn } from "@/lib/utils"

/**
 * One dollar of what Compass pays an agency, split three ways: the worker's pay, the agency's markup, and the VA that
 * comes back to Compass. It's the whole renewal in one picture: more green is better.
 */

export const cents = (n: number) => `${Math.round(n * 100)}¢`

export const PARTS = [
  { key: "worker", label: "To the worker", swatch: "bg-positive" },
  { key: "agency", label: "Agency keeps", swatch: "bg-border-strong" },
  { key: "back", label: "Back to you", swatch: "bg-brand" },
] as const

export type Split = { worker: number; agency: number; back: number }

export function DollarBar({ split, className }: { split: Split; className?: string }) {
  return (
    <span className={cn("flex h-3 w-full overflow-hidden rounded-full bg-muted", className)} aria-label={PARTS.map((p) => `${p.label} ${cents(split[p.key])}`).join(", ")}>
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

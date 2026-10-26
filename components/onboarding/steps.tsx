"use client"

import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/** Where you are in an onboarding dialog. Earlier steps can be revisited; later ones open as you go. */
export function Steps({ steps, current, onPick }: { steps: string[]; current: number; onPick: (index: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={i > current}
            onClick={() => onPick(i)}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption-1 font-semibold transition-colors",
              i === current ? "bg-foreground text-background" : i < current ? "bg-tint-faded text-foreground hover:bg-hover" : "text-subtle",
            )}
          >
            <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", i === current ? "bg-background/20" : i < current ? "bg-positive text-white" : "ring-1 ring-border-strong")}>
              {i < current ? <Check className="size-2.5" /> : i + 1}
            </span>
            {label}
          </button>
          {i < steps.length - 1 && <span className="h-px w-3 bg-border-strong" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-caption-1 font-medium text-faded">{label}</span>
      {children}
      {hint && <span className="text-caption-1 text-subtle">{hint}</span>}
    </label>
  )
}

export const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-body-3 outline-none focus:border-foreground/30 focus:ring-3 focus:ring-foreground/[0.06]"

export function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border p-4">
      <span className="text-caption-1 font-medium text-faded">{label}</span>
      <span className="text-featured-2 font-semibold tabular">{value}</span>
      <span className="text-caption-1 text-faded">{sub}</span>
    </div>
  )
}

export function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption-1 text-faded">{label}</dt>
      <dd className="text-body-3 font-medium">{children}</dd>
    </div>
  )
}

/** A choice that toggles, shown as a chip. */
export function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-body-3 transition-colors disabled:cursor-default disabled:opacity-60",
        on ? "border-foreground/25 bg-foreground/[0.06] font-medium" : "border-dashed border-border-strong text-faded hover:bg-hover hover:text-foreground",
      )}
    >
      {on && <Check className="size-3.5" />}
      {children}
    </button>
  )
}

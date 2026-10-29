"use client"

import { Check } from "lucide-react"

import { InfoTip } from "@/components/common/info-tip"
import { cn } from "@/lib/utils"

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

/** One part of a setup page's form, with its explanation in a tooltip. */
export function Section({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 p-6">
      <h2 className="flex items-center gap-1.5 text-body-2 font-semibold">
        {title}
        {info && <InfoTip>{info}</InfoTip>}
      </h2>
      {children}
    </section>
  )
}

/** One fact in a setup page's summary. */
export function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-faded">{label}</dt>
      <dd className="text-right font-medium tabular">{children}</dd>
    </div>
  )
}

/** A checkbox row, as a button so it reads and toggles the same way everywhere. */
export function CheckRow({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="-mx-1.5 flex h-8 items-center gap-2 rounded-md px-1.5 text-left text-body-3 transition-colors hover:bg-hover">
      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border-strong")}>
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      {children}
    </button>
  )
}

"use client"

import { CalendarDays, ChevronDown } from "lucide-react"
import { useState } from "react"
import type { DateRange } from "react-day-picker"

import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatDateShort, parseDate, toISODate } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface IsoRange {
  from?: string
  to?: string
}

/** "Start/End Date(s)" filter from the partner dashboard's Shifts list. */
export function DateRangeFilter({
  value,
  onChange,
  label = "Start/End Date(s)",
  className,
}: {
  value: IsoRange
  onChange: (value: IsoRange) => void
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected: DateRange | undefined = value.from ? { from: parseDate(value.from), to: value.to ? parseDate(value.to) : undefined } : undefined
  const summary = value.from ? `${formatDateShort(value.from)}${value.to && value.to !== value.from ? ` – ${formatDateShort(value.to)}` : ""}` : "Any date"
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border-strong bg-background px-2.5 text-body-3 outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-hover",
            value.from && "border-solid border-foreground/20 bg-foreground/[0.03]",
            className,
          )}
        >
          <CalendarDays className="size-3.5 text-subtle" />
          <span className="text-faded">{label}</span>
          <span className={value.from ? "font-medium" : "text-faded"}>{summary}</span>
          <ChevronDown className="size-3.5 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(r) => onChange({ from: r?.from ? toISODate(r.from) : undefined, to: r?.to ? toISODate(r.to) : undefined })}
        />
        <div className="flex items-center justify-between border-t border-border px-2 pt-2">
          <button type="button" className="text-body-3 text-faded transition-colors hover:text-foreground" onClick={() => onChange({})}>
            Clear dates
          </button>
          <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-body-3 font-semibold text-primary-foreground" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

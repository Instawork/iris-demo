"use client"

import { CalendarDays, ChevronDown } from "lucide-react"
import { useState } from "react"
import type { DateRange } from "react-day-picker"

import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { addDaysISO, formatDateShort, parseDate, toISODate, weekStartISO } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface IsoRange {
  from?: string
  to?: string
}

export interface RangePreset {
  label: string
  range: Required<IsoRange>
}

/** The periods finance asks about most, ending today at the latest. Weeks run Saturday to Friday, like the invoices. */
export function periodPresets(today: string): RangePreset[] {
  const week = weekStartISO(today)
  const month = `${today.slice(0, 7)}-01`
  const lastMonth = `${addDaysISO(month, -1).slice(0, 7)}-01`
  return [
    { label: "This week", range: { from: week, to: today } },
    { label: "Last week", range: { from: addDaysISO(week, -7), to: addDaysISO(week, -1) } },
    { label: "This month", range: { from: month, to: today } },
    { label: "Last month", range: { from: lastMonth, to: addDaysISO(month, -1) } },
    { label: "Year to date", range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
  ]
}

/** Whether a span of days overlaps the range. A range with only a start covers that one day. */
export function overlaps(range: IsoRange, from: string, to = from) {
  const end = range.to ?? range.from
  return (!range.from || to >= range.from) && (!end || from <= end)
}

/** "Start/End Date(s)" filter from the partner dashboard's Shifts list. */
export function DateRangeFilter({
  value,
  onChange,
  label = "Start/End Date(s)",
  presets,
  className,
}: {
  value: IsoRange
  onChange: (value: IsoRange) => void
  label?: string
  presets?: RangePreset[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected: DateRange | undefined = value.from ? { from: parseDate(value.from), to: value.to ? parseDate(value.to) : undefined } : undefined
  const preset = presets?.find((p) => p.range.from === value.from && p.range.to === value.to)
  const summary = preset
    ? preset.label
    : value.from
      ? `${formatDateShort(value.from)}${value.to && value.to !== value.from ? ` – ${formatDateShort(value.to)}` : ""}`
      : "Any date"
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
        <div className="flex">
          {presets && (
            <div className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-border pr-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={cn("rounded-md px-2 py-1.5 text-left text-body-3 transition-colors hover:bg-hover", p === preset ? "bg-hover font-semibold" : "text-faded")}
                  onClick={() => {
                    onChange(p.range)
                    setOpen(false)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={selected}
            defaultMonth={selected?.from}
            onSelect={(r) => onChange({ from: r?.from ? toISODate(r.from) : undefined, to: r?.to ? toISODate(r.to) : undefined })}
          />
        </div>
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

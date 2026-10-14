"use client"

import { Check, ChevronDown, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface FilterOption {
  value: string
  label: string
  hint?: string
  icon?: React.ReactNode
}

const triggerClass =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border-strong bg-background px-2.5 text-body-3 text-foreground transition-colors duration-100 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-hover"

const activeClass = "border-solid border-foreground/20 bg-foreground/[0.03]"

/** Inline multi-select filter. Empty selection means all. */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  searchable,
  allLabel = "All",
  className,
}: {
  label: string
  options: FilterOption[]
  value: string[]
  onChange: (value: string[]) => void
  searchable?: boolean
  allLabel?: string
  className?: string
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  )
  const summary =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? "1 selected")
        : `${value.length} selected`
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerClass, value.length > 0 && activeClass, className)}>
          <span className="text-faded">{label}</span>
          <span className={cn("max-w-[180px] truncate", value.length > 0 ? "font-medium" : "text-faded")}>{summary}</span>
          <ChevronDown className="size-3.5 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        {searchable && (
          <div className="mb-1 flex items-center gap-2 rounded-md border border-border px-2">
            <Search className="size-4 text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="h-8 w-full bg-transparent text-body-3 outline-none placeholder:text-subtle"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => onChange([])}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-3 hover:bg-hover"
        >
          <span className={cn("flex size-4 items-center justify-center rounded border", value.length === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
            {value.length === 0 && <Check className="size-3" />}
          </span>
          {allLabel}
        </button>
        <div className="max-h-64 overflow-y-auto scrollbar-thin">
          {filtered.map((o) => {
            const on = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-3 hover:bg-hover"
              >
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                  {on && <Check className="size-3" />}
                </span>
                {o.icon}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="truncate text-caption-1 text-faded">{o.hint}</span>}
                </span>
              </button>
            )
          })}
          {filtered.length === 0 && <p className="px-2 py-3 text-center text-body-3 text-faded">No matches</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Single-choice filter rendered as the same inline trigger. */
export function SelectFilter({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerClass, current && current.value !== options[0]?.value && activeClass, className)}>
          <span className="text-faded">{label}</span>
          <span className={cn("max-w-[180px] truncate", current && current.value !== options[0]?.value ? "font-medium" : "text-faded")}>{current?.label ?? "Any"}</span>
          <ChevronDown className="size-3.5 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              onChange(o.value)
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-3 hover:bg-hover"
          >
            <Check className={cn("size-4 text-foreground", o.value === value ? "opacity-100" : "opacity-0")} />
            {o.icon}
            <span className="flex flex-col">
              <span>{o.label}</span>
              {o.hint && <span className="text-caption-1 text-faded">{o.hint}</span>}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("flex h-8 items-center gap-2 rounded-lg border border-input bg-background px-2.5 transition-[border-color,box-shadow] duration-100 focus-within:border-foreground/30 focus-within:ring-3 focus-within:ring-foreground/[0.06]", className)}>
      <Search className="size-4 shrink-0 text-subtle" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full min-w-0 bg-transparent text-body-3 outline-none placeholder:text-subtle"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-subtle hover:text-foreground" aria-label="Clear search">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export function ResetFilters({ onClick, show }: { onClick: () => void; show: boolean }) {
  if (!show) return null
  return (
    <button type="button" onClick={onClick} className="h-8 rounded-lg px-2 text-body-3 text-faded transition-colors duration-100 hover:bg-hover hover:text-foreground">
      Reset
    </button>
  )
}

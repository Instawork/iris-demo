"use client"

import { MapPin } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** A dropdown of cities, so the list stays one control however many markets there are. */
export function CitySelect<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: string }[]
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className={cn("h-9 w-52 gap-2 bg-background", className)} data-tour="city-select">
        <MapPin className="size-4 text-faded" />
        <span className="flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

"use client"

import { addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { motion } from "motion/react"
import { useMemo, useState } from "react"

import { ShiftCard } from "@/components/shifts/shift-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { addDaysISO, formatDateLong, formatGroupHeader, parseDate, toISODate, todayISO } from "@/lib/dates"
import { filledCount, fillTone } from "@/lib/metrics"
import { position, supplier } from "@/lib/reference"
import type { ShiftGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

const TONE_BAR = {
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-border-strong",
}

/** Month view: each day previews its shifts with fill, click a day for the full cards. */
export function ShiftsCalendar({ groups }: { groups: ShiftGroup[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [openDay, setOpenDay] = useState<string | undefined>()
  const byDay = useMemo(() => {
    const map = new Map<string, ShiftGroup[]>()
    for (const g of groups) {
      const list = map.get(g.date) ?? []
      list.push(g)
      map.set(g.date, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start))
    return map
  }, [groups])

  const days = useMemo(() => {
    const start = toISODate(startOfWeek(startOfMonth(month), { weekStartsOn: 0 }))
    const end = toISODate(endOfWeek(endOfMonth(month), { weekStartsOn: 0 }))
    const list: string[] = []
    for (let d = start; d <= end; d = addDaysISO(d, 1)) list.push(d)
    return list
  }, [month])

  const today = todayISO()
  const dayGroups = openDay ? (byDay.get(openDay) ?? []) : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-9 rounded-lg" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="size-9 rounded-lg" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          <motion.h2 key={month.toISOString()} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="ml-1 text-featured-3 font-bold">
            {format(month, "MMMM yyyy")}
          </motion.h2>
        </div>
        <Button variant="outline" className="h-9 rounded-lg" onClick={() => setMonth(startOfMonth(new Date()))}>
          Today
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border bg-page-faded">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-caption-1 font-medium text-faded">
              {d}
            </div>
          ))}
        </div>
        <motion.div key={month.toISOString()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-7">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? []
            const inMonth = isSameMonth(parseDate(d), month)
            const isToday = d === today
            return (
              <button
                key={d}
                type="button"
                disabled={!list.length}
                onClick={() => setOpenDay(d)}
                className={cn(
                  "group flex min-h-[112px] flex-col gap-1 border-b border-border p-1.5 text-left transition-colors",
                  (i + 1) % 7 !== 0 && "border-r",
                  !inMonth && "bg-page-faded/70",
                  list.length && "hover:bg-hover",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center self-start rounded-full text-caption-1 font-semibold",
                    isToday ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-subtle",
                  )}
                >
                  {parseDate(d).getDate()}
                </span>
                {list.slice(0, 3).map((g) => (
                  <span key={g.id} className={cn("flex items-center gap-1.5 rounded-md bg-card px-1.5 py-0.5 text-[11px] leading-4 shadow-[0_0_0_1px_var(--border)]", g.cancelledAt && "line-through opacity-50")}>
                    <span className={cn("h-3 w-1 shrink-0 rounded-full", TONE_BAR[fillTone(g)])} />
                    <span className="truncate font-medium">{position(g.positionId).name}</span>
                    <span className="ml-auto shrink-0 text-faded tabular">
                      {filledCount(g)}/{g.slots.length}
                    </span>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: supplier(g.supplierId).color }} />
                  </span>
                ))}
                {list.length > 3 && <span className="px-1.5 text-[11px] font-medium text-primary">+{list.length - 3} more</span>}
              </button>
            )
          })}
        </motion.div>
      </div>
      <Dialog open={!!openDay} onOpenChange={(o) => !o && setOpenDay(undefined)}>
        <DialogContent className="max-h-[86svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-6 pt-6 pb-4">
            <DialogTitle className="text-featured-3 font-bold">{openDay ? formatDateLong(openDay) : ""}</DialogTitle>
            <DialogDescription>{openDay ? `${formatGroupHeader(openDay).split(" • ")[0]} · ${dayGroups.length} shift group${dayGroups.length === 1 ? "" : "s"}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[70svh] flex-col gap-3 overflow-y-auto bg-page-faded p-4 scrollbar-thin">
            {dayGroups.map((g) => (
              <ShiftCard key={g.id} group={g} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

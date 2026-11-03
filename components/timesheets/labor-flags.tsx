"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { useMemo } from "react"

import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { useData } from "@/hooks/use-app"
import { formatDay, todayISO } from "@/lib/dates"
import { fullName, plural } from "@/lib/format"
import { STATE_NAME, laborFlags, type LaborFlag } from "@/lib/labor"
import { supplier } from "@/lib/reference"
import { OVERTIME_RATE } from "@/lib/timesheets"

const SHOWN = 3

/** A buyer's workers short of a state's meal break, or headed past 40 hours this week. Hidden when there's nothing to flag. */
export function LaborFlags({ buyerId, onOpen }: { buyerId: string; onOpen: (timesheetId: string) => void }) {
  const data = useData()
  const flags = useMemo(() => laborFlags(data, buyerId, todayISO()), [data, buyerId])
  if (!flags.length) return null
  const rest = flags.length - SHOWN
  return (
    <Surface elevated className="overflow-hidden" data-tour="labor-flags">
      <SurfaceHeader
        title="Breaks and overtime"
        description={plural(flags.length, "worker")}
        info="Each shift is held to its state's meal-break rule, and each worker's week to 40 hours with one agency, shifts already booked included."
      />
      <ul className="mt-2 divide-y divide-border/60 border-t border-border/60">
        {flags.slice(0, SHOWN).map((f) => (
          <FlagRow key={f.id} flag={f} onOpen={onOpen} />
        ))}
      </ul>
      {rest > 0 && <p className="border-t border-border/60 px-5 py-2.5 text-caption-1 text-faded">And {rest} more</p>}
    </Surface>
  )
}

function FlagRow({ flag, onOpen }: { flag: LaborFlag; onOpen: (timesheetId: string) => void }) {
  const data = useData()
  const pro = data.pros.find((p) => p.id === flag.proId)
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        {pro && <ProAvatar pro={pro} size="sm" />}
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{pro ? fullName(pro) : "Unknown worker"}</span>
            <StatusBadge tone="warning" size="sm">
              {flag.kind === "overtime" ? `Overtime ${formatDay(flag.date, "EEE")}` : "No meal break"}
            </StatusBadge>
          </span>
          <span className="truncate text-caption-1 text-faded">{detail(flag)}</span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle" />
    </>
  )
  const row = "flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-body-3 hover:bg-foreground/[0.03]"
  return (
    <li>
      {flag.kind === "overtime" ? (
        <Link href={`/shifts/${flag.groupId}`} className={row}>
          {body}
        </Link>
      ) : (
        <button type="button" className={row} onClick={() => onOpen(flag.timesheetId)}>
          {body}
        </button>
      )}
    </li>
  )
}

function detail(flag: LaborFlag) {
  if (flag.kind === "overtime") {
    const agency = supplier(flag.supplierId).shortName
    const lead = flag.booked ? `${formatDay(flag.date, "EEEE")}'s shift takes them to ${flag.total} hrs with ${agency}` : `${flag.total} hrs this week with ${agency}`
    return `${lead}, ${flag.over} past 40 at ${OVERTIME_RATE}×.`
  }
  const taken = flag.breakMins ? `only a ${flag.breakMins}-minute break` : "no break"
  return `${flag.span} hrs on ${formatDay(flag.date)} with ${taken}. ${STATE_NAME[flag.state] ?? flag.state} requires ${flag.rule.minutes} minutes from ${flag.rule.hours} hrs.`
}

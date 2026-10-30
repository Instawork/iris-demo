"use client"

import { ScanLine } from "lucide-react"
import { motion } from "motion/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useData } from "@/hooks/use-app"
import { formatClockShort, formatDay } from "@/lib/dates"
import { fullName, plural } from "@/lib/format"
import { matchSheet, sheetShifts, writtenSheet, type SheetLine, type SheetMatch } from "@/lib/paper-sheet"
import { buyer, location, position } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { ShiftGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

/** An agency reads a venue's paper sign-in sheet into the shift's timesheets instead of typing it in. */
export function ScanSheetDialog({ supplierId, open, onOpenChange }: { supplierId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-tour="scan-sheet">
        {open && <ScanBody supplierId={supplierId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ScanBody({ supplierId, onDone }: { supplierId: string; onDone: () => void }) {
  const data = useData()
  const editTimesheet = useStore((s) => s.editTimesheet)
  const shifts = useMemo(() => sheetShifts(data, supplierId), [data, supplierId])
  const [groupId, setGroupId] = useState(shifts[0]?.group.id)
  const [phase, setPhase] = useState<"sheet" | "reading" | "read">("sheet")
  const [busy, setBusy] = useState(false)
  const shift = shifts.find((s) => s.group.id === groupId) ?? shifts[0]
  const lines = useMemo(() => (shift ? writtenSheet(shift.sheets, data.pros) : []), [shift, data.pros])
  const matches = useMemo(() => (shift ? matchSheet(lines, shift.sheets, data.pros) : []), [lines, shift, data.pros])
  const [skip, setSkip] = useState<Set<number>>(new Set())

  if (!shift) {
    return (
      <DialogHeader>
        <DialogTitle>Scan a sign-in sheet</DialogTitle>
        <DialogDescription>No shift has hours waiting for you to submit.</DialogDescription>
      </DialogHeader>
    )
  }

  const changes = matches.filter((m, i) => m.timesheet && m.state !== "matches" && !skip.has(i))
  const read = () => {
    setPhase("reading")
    window.setTimeout(() => setPhase("read"), 1500)
  }
  const apply = async () => {
    setBusy(true)
    let done = 0
    for (const m of changes) {
      if (await editTimesheet(m.timesheet!.id, { clockIn: m.line.in, clockOut: m.line.out, breakMins: m.line.breakMins }, "From the paper sign-in sheet")) done++
    }
    setBusy(false)
    const same = matches.filter((m) => m.state === "matches").length
    toast.success(`Updated ${plural(done, "timesheet")} from the sheet`, { description: same ? `${plural(same, "line")} already matched the clock.` : undefined })
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan a sign-in sheet</DialogTitle>
        <DialogDescription>Iris reads each line, finds the worker and checks the hours against its clock.</DialogDescription>
      </DialogHeader>

      {phase !== "read" ? (
        <div className="flex flex-col gap-3">
          {shifts.length > 1 && (
            <Select
              value={shift.group.id}
              onValueChange={(v) => {
                setGroupId(v)
                setSkip(new Set())
              }}
              disabled={phase === "reading"}
            >
              <SelectTrigger className="h-9 w-full sm:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shifts.map(({ group, sheets }) => (
                  <SelectItem key={group.id} value={group.id}>
                    {position(group.positionId).name} · {location(group.locationId).name} · {formatDay(group.date)} <span className="text-faded">({sheets.length})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Paper group={shift.group} lines={lines} scanning={phase === "reading"} />
          <span className="text-caption-1 text-faded">A sample sheet for this shift. On the floor, it&apos;s a photo from the agency&apos;s phone.</span>
        </div>
      ) : (
        <Results matches={matches} skip={skip} onToggle={(i) => setSkip((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
      )}

      <DialogFooter>
        {phase === "read" ? (
          <>
            <Button variant="ghost" onClick={() => setPhase("sheet")}>
              Back to the sheet
            </Button>
            <Button onClick={apply} disabled={busy || !changes.length} data-tour="scan-apply" autoFocus>
              {changes.length ? `Update ${plural(changes.length, "timesheet")}` : "Nothing to update"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button onClick={read} disabled={phase === "reading"} data-tour="scan-read" autoFocus>
              <ScanLine /> {phase === "reading" ? "Reading…" : "Read the sheet"}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}

const HAND = { fontFamily: '"Bradley Hand", "Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive' }
const INK = "oklch(0.38 0.12 262)"

function Paper({ group, lines, scanning }: { group: ShiftGroup; lines: SheetLine[]; scanning: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-[#f7f4ec] p-5 text-[#2b2a27] shadow-raised dark:bg-[#e9e5da]">
      <div className="-rotate-[0.6deg]">
        <div className="flex items-baseline justify-between border-b-2 border-[#2b2a27]/70 pb-2">
          <span className="text-[13px] font-bold tracking-wide uppercase">Sign-in sheet</span>
          <span className="text-[12px]">
            {buyer(group.buyerId).name} · {location(group.locationId).name} · {position(group.positionId).name} · {formatDay(group.date, "EEE MMM d")}
          </span>
        </div>
        <div className="grid grid-cols-[1.6fr_1.2fr_0.7fr_0.7fr_0.6fr] border-b border-[#2b2a27]/40 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
          <span>Print name</span>
          <span>Signature</span>
          <span>In</span>
          <span>Out</span>
          <span>Break</span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid h-9 grid-cols-[1.6fr_1.2fr_0.7fr_0.7fr_0.6fr] items-end border-b border-[#2b2a27]/25 pb-1 text-[17px]" style={{ ...HAND, color: INK }}>
            <span style={{ transform: `rotate(${((i * 37) % 5) - 2}deg)` }} className="origin-left">
              {l.written}
            </span>
            <svg viewBox="0 0 120 24" className="h-6 w-28" aria-hidden>
              <path d={squiggle(i)} fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>{formatClockShort(l.in)}</span>
            <span>{formatClockShort(l.out)}</span>
            <span>{l.breakMins}</span>
          </div>
        ))}
      </div>
      {scanning && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
          initial={{ top: "-15%" }}
          animate={{ top: "100%" }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        />
      )}
    </div>
  )
}

const squiggle = (seed: number) => {
  const pts = Array.from({ length: 7 }, (_, k) => [8 + k * 16, 12 + (((seed * 13 + k * 29) % 17) - 8)])
  return `M${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(([x, y], k) => `Q${x - 8} ${k % 2 ? 2 : 22} ${x} ${y}`).join(" ")
}

const STATE: Record<SheetMatch["state"], { tone: "positive" | "warning" | "neutral" | "critical" | "primary"; text: (m: SheetMatch) => string }> = {
  matches: { tone: "positive", text: () => "Matches the clock" },
  over: { tone: "warning", text: (m) => `${m.vsClock} min more than the clock` },
  under: { tone: "neutral", text: (m) => `${-(m.vsClock ?? 0)} min less than the clock` },
  fills: { tone: "primary", text: () => "Fills the missing punch" },
  no_clock: { tone: "primary", text: () => "No clock punch. Uses the sheet" },
  unmatched: { tone: "critical", text: () => "No one on this shift by that name" },
}

function Results({ matches, skip, onToggle }: { matches: SheetMatch[]; skip: Set<number>; onToggle: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-body-3 text-faded">
        {plural(matches.length, "line")} read, {plural(matches.filter((m) => m.timesheet).length, "worker")} found. Ticked lines update the timesheet.
      </span>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {matches.map((m, i) => {
          const state = STATE[m.state]
          const changes = !!m.timesheet && m.state !== "matches"
          return (
            <li key={i} className={cn("flex items-center gap-3 px-3 py-2.5 text-body-3", m.state === "over" && "bg-warning-faded/40")}>
              <Checkbox checked={changes && !skip.has(i)} disabled={!changes} onCheckedChange={() => onToggle(i)} aria-label={`Use the sheet for ${m.line.written}`} />
              <span className="w-36 shrink-0 truncate text-[15px]" style={{ ...HAND, color: INK }}>
                {m.line.written}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {m.pro ? (
                  <>
                    <ProAvatar pro={m.pro} size="sm" />
                    <span className="truncate font-medium">{fullName(m.pro)}</span>
                  </>
                ) : (
                  <span className="text-faded">Not matched</span>
                )}
              </span>
              <span className="w-44 shrink-0 text-right whitespace-nowrap tabular">
                {formatClockShort(m.line.in)}–{formatClockShort(m.line.out)}
                {m.timesheet?.clock?.in && m.timesheet.clock.out && (
                  <span className="block text-caption-1 text-faded">
                    Clock {formatClockShort(m.timesheet.clock.in)}–{formatClockShort(m.timesheet.clock.out)}
                  </span>
                )}
              </span>
              <StatusBadge tone={state.tone} size="sm" className="w-44 shrink-0 justify-center">
                {state.text(m)}
              </StatusBadge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

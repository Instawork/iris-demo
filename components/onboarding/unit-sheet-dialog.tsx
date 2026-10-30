"use client"

import { FileSpreadsheet, ScanLine, TriangleAlert } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

import { Tip } from "@/components/common/info-tip"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { plural } from "@/lib/format"
import { buyer, city } from "@/lib/reference"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { ROSTER_HEADERS, SAMPLE_UNIT_SHEET, UNIT_SHEET_FILE, costCentersIn, readUnitSheet, type UnitSheetLine } from "@/lib/unit-sheet"

/** Compass adds a whole sheet of locations as units, each with its cost centers, instead of one form at a time. */
export function UnitSheetDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: (ids: string[]) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl" data-tour="units-sheet">
        {open && (
          <SheetBody
            onDone={(ids) => {
              onOpenChange(false)
              if (ids.length) onAdded(ids)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SheetBody({ onDone }: { onDone: (ids: string[]) => void }) {
  const importUnits = useStore((s) => s.importUnits)
  const [phase, setPhase] = useState<"sheet" | "reading" | "read">("sheet")
  const [busy, setBusy] = useState(false)
  const [lines] = useState(() => readUnitSheet(SAMPLE_UNIT_SHEET))
  const ready = lines.filter((l) => l.input)
  const centers = costCentersIn(lines)

  const read = () => {
    setPhase("reading")
    window.setTimeout(() => setPhase("read"), 1500)
  }
  const apply = async () => {
    setBusy(true)
    const result = await importUnits(ready.map((l) => l.input!))
    setBusy(false)
    if (!result) return
    toast.success(`${plural(result.ids.length, "unit")} added`, { description: `${plural(centers, "cost center")}, each under its business and market.` })
    onDone(result.ids)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Upload the location roster</DialogTitle>
        <DialogDescription>Iris files each one under its business and market, with a cost center for every department.</DialogDescription>
      </DialogHeader>

      {phase === "read" ? <Results lines={lines} ready={ready} centers={centers} /> : <Sheet lines={lines} scanning={phase === "reading"} />}

      <DialogFooter>
        {phase === "read" ? (
          <>
            <Button variant="ghost" onClick={() => setPhase("sheet")}>
              Back to the sheet
            </Button>
            <Button onClick={apply} disabled={busy || !ready.length} data-tour="units-import" autoFocus>
              {ready.length ? `Add ${plural(ready.length, "unit")}` : "Nothing to add"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onDone([])}>
              Cancel
            </Button>
            <Button onClick={read} disabled={phase === "reading"} data-tour="units-read" autoFocus>
              <ScanLine /> {phase === "reading" ? "Reading…" : "Read the sheet"}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}

function Sheet({ lines, scanning }: { lines: UnitSheetLine[]; scanning: boolean }) {
  const cell = "border-r border-b border-border/70 px-2 py-1.5 whitespace-nowrap"
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center gap-1.5 text-caption-1 text-faded">
        <FileSpreadsheet className="size-3.5 text-positive-fg" />
        <span className="font-medium text-foreground">{UNIT_SHEET_FILE}</span> · {plural(lines.length, "row")}
      </span>
      <div className="relative max-h-[46vh] overflow-auto rounded-lg border border-border bg-card scrollbar-thin">
        <table className="w-full border-collapse text-left text-caption-1">
          <thead className="sticky top-0 z-10 bg-page-faded">
            <tr>
              <th className={`${cell} w-8 text-center font-normal text-faded`} />
              {ROSTER_HEADERS.map((h) => (
                <th key={h} className={`${cell} font-semibold`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line}>
                <td className={`${cell} bg-page-faded text-center text-faded tabular`}>{l.line}</td>
                {ROSTER_HEADERS.map((h) => (
                  <td key={h} className={cn(cell, h === "Customer" && "font-medium", h === "Financial Code" && "font-mono")}>
                    {l.row[h]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {scanning && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
            initial={{ top: "-15%" }}
            animate={{ top: "100%" }}
            transition={{ duration: 1.4, ease: "easeInOut" }}
          />
        )}
      </div>
    </div>
  )
}

function Results({ lines, ready, centers }: { lines: UnitSheetLine[]; ready: UnitSheetLine[]; centers: number }) {
  const held = lines.filter((l) => l.issue)
  const groups = [...new Set(ready.map((l) => `${l.input!.buyerId}|${l.cityId}`))].map((k) => {
    const [buyerId, cityId] = k.split("|")
    const mine = ready.filter((l) => l.input!.buyerId === buyerId && l.cityId === cityId)
    return { key: k, buyerId, cityId, units: mine, centers: costCentersIn(mine) }
  })
  return (
    <div className="flex min-w-0 flex-col gap-3 text-body-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-raised">
        <div className="flex items-end justify-between gap-4 border-b border-border px-4 py-3">
          <span className="flex flex-col">
            <span className="text-caption-1 font-medium text-faded">Ready to add</span>
            <span className="text-body-1 font-semibold tabular">
              {plural(ready.length, "unit")} · {plural(centers, "cost center")}
            </span>
          </span>
          <span className="text-caption-1 text-faded">One for each unit, one for each department</span>
        </div>
        <ul className="divide-y divide-border">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{buyer(g.buyerId).name}</span>
                <span className="text-caption-1 text-faded">
                  {buyer(g.buyerId).sector} · {city(g.cityId).name}, {city(g.cityId).state}
                </span>
              </span>
              <Tip content={g.units.map((l) => l.row.Customer).join(", ")}>
                <span className="shrink-0 text-right tabular">
                  <span className="font-semibold">{plural(g.units.length, "unit")}</span>
                  <span className="block text-caption-1 text-faded">{plural(g.centers, "cost center")}</span>
                </span>
              </Tip>
            </li>
          ))}
        </ul>
      </div>
      {held.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <span className="flex items-center gap-1.5 px-4 pt-3 text-caption-1 font-medium text-faded">
            <TriangleAlert className="size-3.5 text-warning-fg" />
            Held back · {held.length}
          </span>
          <ul className="divide-y divide-border px-4">
            {held.map((l) => (
              <li key={l.line} className="flex items-center justify-between gap-4 py-2.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-caption-1 text-faded tabular">Row {l.line}</span>
                  <span className="truncate font-semibold">{l.row.Customer}</span>
                </span>
                <span className="shrink-0 text-caption-1 font-medium text-warning-fg">{l.issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

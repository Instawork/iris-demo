"use client"

import { BadgeDollarSign, CalendarPlus, ChartColumn, Clock, Coins, Download, Paperclip, Upload, Users, X, type LucideIcon } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { InfoTip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { SyncedBadge } from "@/components/common/synced-badge"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { UPLOAD_SPECS, downloadCsv, isSynced, sampleName, specsFor, templateCsv, templateName } from "@/lib/csv"
import { isSpreadsheetFile, spreadsheetToCsv } from "@/lib/spreadsheet"
import type { UploadType, Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

export const UPLOAD_ICONS: Record<UploadType, LucideIcon> = {
  shifts: CalendarPlus,
  timesheets: Clock,
  tips: Coins,
  rates: BadgeDollarSign,
  professionals: Users,
  activity: ChartColumn,
}

/** The preferred type when this workspace can upload it, otherwise its first type that isn't synced by API. */
export function defaultUploadType(ws: Workspace, preferred?: UploadType): UploadType {
  const specs = specsFor(ws.kind)
  if (preferred && specs.some((s) => s.type === preferred)) return preferred
  return (specs.find((s) => !isSynced(ws, s.type)) ?? specs[0]).type
}

type Picked = { name: string; csv: string; sample: boolean }

/** Type, template, file and Upload: the same bar on the Uploads page and in the upload dialog. */
export function UploadPicker({
  type,
  onTypeChange,
  onUpload,
  className,
}: {
  type: UploadType
  onTypeChange: (type: UploadType) => void
  onUpload: (type: UploadType, fileName: string, csv: string) => void
  className?: string
}) {
  const data = useData()
  const { ws } = useWorkspace()
  const [file, setFile] = useState<Picked>()
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const specs = specsFor(ws.kind)
  const spec = UPLOAD_SPECS[type]
  const synced = isSynced(ws, type)

  const clear = () => {
    setFile(undefined)
    if (inputRef.current) inputRef.current.value = ""
  }

  const choose = async (f?: File) => {
    if (!f) return
    if (!isSpreadsheetFile(f)) {
      toast.error("That's not a spreadsheet", { description: "Choose a CSV or Excel (.xlsx) file." })
      return
    }
    if (f.size > 2_000_000) {
      toast.error("File is too large", { description: "Keep uploads under 2 MB, about 20,000 rows." })
      return
    }
    try {
      setFile({ name: f.name, csv: await spreadsheetToCsv(f), sample: false })
    } catch (error) {
      toast.error(`Couldn't read ${f.name}`, { description: error instanceof Error ? error.message : "Try exporting the sheet as CSV." })
    }
  }

  const trySample = () => {
    const csv = templateCsv(type, data, ws, true)
    if (!csv.includes("\n")) {
      toast(`No ${spec.label.toLowerCase()} sample right now`, { description: "There's nothing in your workspace to build one from yet." })
      return
    }
    setFile({ name: sampleName(type), csv, sample: true })
  }

  const upload = () => {
    if (!file) return
    onUpload(type, file.name, file.csv)
    clear()
  }

  return (
    <div
      onDragOver={(e) => {
        if (synced) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!synced) void choose(e.dataTransfer.files?.[0])
      }}
      className={cn("flex flex-col gap-3 rounded-lg", dragging && "outline-2 outline-offset-4 outline-border-strong outline-dashed", className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-body-3 font-medium text-faded">Type</span>
        <PillTabs
          value={type}
          onChange={(next) => {
            onTypeChange(next)
            if (file?.sample) clear()
          }}
          items={specs.map((s) => ({ value: s.type, label: s.label, icon: UPLOAD_ICONS[s.type] }))}
        />
        <InfoTip label={`About ${spec.label.toLowerCase()} files`}>
          <span className="flex flex-col gap-1.5">
            <span>{spec.description}</span>
            <span className="opacity-75">Required: {spec.columns.filter((c) => c.required).map((c) => c.key).join(", ")}</span>
            {spec.columns.some((c) => !c.required) && (
              <span className="opacity-75">Optional: {spec.columns.filter((c) => !c.required).map((c) => c.key).join(", ")}</span>
            )}
          </span>
        </InfoTip>
      </div>
      {synced && ws.supplierId ? (
        <div className="flex items-center gap-2">
          <SyncedBadge supplierId={ws.supplierId} />
          <span className="text-caption-1 text-faded">Your integration sends these, so there&apos;s nothing to upload.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => downloadCsv(templateName(type), templateCsv(type, data, ws))}>
            <Download className="size-4" /> Download template
          </Button>
          <Button variant="outline" className="h-9 max-w-72 gap-1.5 rounded-lg text-body-3" onClick={() => inputRef.current?.click()}>
            <Paperclip className="size-4" />
            <span className={cn("truncate", file && "font-medium")}>{file ? file.name : "Choose file"}</span>
          </Button>
          {file ? (
            <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={clear}>
              <X className="size-4" />
            </Button>
          ) : (
            <button
              type="button"
              onClick={trySample}
              className="rounded px-1 text-caption-1 font-medium text-faded underline-offset-4 transition-colors duration-100 hover:text-foreground hover:underline"
            >
              Try a sample
            </button>
          )}
          <Button className="ml-auto h-9 gap-1.5 rounded-lg px-4 text-body-3 font-semibold" disabled={!file} onClick={upload}>
            <Upload className="size-4" /> Upload
          </Button>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" tabIndex={-1} className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
      )}
    </div>
  )
}

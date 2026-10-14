"use client"

import { CircleCheck, CircleX, Download, FileSpreadsheet, Info, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"

import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { Tip } from "@/components/common/info-tip"
import { PageHeader, SectionTitle } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ReviewFixes } from "@/components/uploads/review-fixes"
import { UPLOAD_ICONS, UploadPicker, defaultUploadType } from "@/components/uploads/upload-picker"
import { useUploadFlow, type ReviewSession } from "@/components/uploads/use-upload-flow"
import { useData, useWorkspace } from "@/hooks/use-app"
import { UPLOAD_SPECS, columnLabel, downloadCsv, exportName, toCsv, uploadsFor } from "@/lib/csv"
import { formatDateShort, formatTimestamp } from "@/lib/dates"
import type { Upload, UploadType } from "@/lib/types"
import { cn } from "@/lib/utils"

const statusLabel = (u: Upload) => (u.status === "needs_review" ? `${u.errorRows} to review` : u.status === "failed" ? "Failed" : "Saved")

function UploadStatus({ upload, onReview }: { upload: Upload; onReview?: (u: Upload) => void }) {
  if (upload.status === "needs_review")
    return (
      <span className="flex items-center gap-2">
        <StatusBadge tone="warning">{statusLabel(upload)}</StatusBadge>
        {onReview && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-md text-caption-1"
            onClick={(e) => {
              e.stopPropagation()
              onReview(upload)
            }}
          >
            Review fixes
          </Button>
        )}
      </span>
    )
  if (upload.status === "failed")
    return (
      <Tip content={upload.summary}>
        <span>
          <StatusBadge tone="critical">Failed</StatusBadge>
        </span>
      </Tip>
    )
  return (
    <Tip content={upload.errorRows ? `${upload.errorRows} ${upload.errorRows === 1 ? "row was" : "rows were"} left out` : undefined}>
      <span>
        <StatusBadge tone="positive" dot>
          Saved
        </StatusBadge>
      </span>
    </Tip>
  )
}

export function UploadsPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const flow = useUploadFlow()
  const [type, setType] = useState<UploadType>(() => defaultUploadType(ws))
  const [session, setSession] = useState<ReviewSession>()
  const [reviewing, setReviewing] = useState(false)
  const [openId, setOpenId] = useState<string>()
  const uploads = useMemo(() => uploadsFor(data, ws), [data, ws])
  const open = uploads.find((u) => u.id === openId)

  const startReview = (next?: ReviewSession) => {
    if (!next) return
    setSession(next)
    setReviewing(true)
  }

  const review = (u: Upload) => {
    setOpenId(undefined)
    startReview(flow.resume(u))
  }

  const upload = (t: UploadType, fileName: string, csv: string) => {
    const result = flow.submit(t, fileName, csv)
    if (result.status === "review") startReview(result.session)
  }

  const closeReview = () => {
    if (session) flow.hold(session)
    setReviewing(false)
  }

  const columns: Column<Upload>[] = [
    {
      id: "file",
      header: "File",
      className: "whitespace-normal",
      sortValue: (u) => u.fileName.toLowerCase(),
      cell: (u) => (
        <span className="flex min-w-48 items-start gap-2.5">
          <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-faded" />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-all">{u.fileName}</span>
            <span className="text-caption-1 text-faded">{u.summary}</span>
          </span>
        </span>
      ),
    },
    {
      id: "type",
      header: "Type",
      sortValue: (u) => UPLOAD_SPECS[u.type].label,
      cell: (u) => {
        const Icon = UPLOAD_ICONS[u.type]
        return (
          <span className="inline-flex items-center gap-1.5">
            <Icon className="size-4 text-faded" /> {UPLOAD_SPECS[u.type].label}
          </span>
        )
      },
    },
    {
      id: "at",
      header: "Uploaded",
      sortValue: (u) => u.uploadedAt,
      cell: (u) => (
        <Tip content={`${formatTimestamp(u.uploadedAt)} by ${u.uploadedBy}`}>
          <span>{formatDateShort(u.uploadedAt)}</span>
        </Tip>
      ),
    },
    { id: "rows", header: "Rows", align: "right", sortValue: (u) => u.totalRows, cell: (u) => u.totalRows.toLocaleString("en-US") },
    { id: "status", header: "Status", sortValue: (u) => statusLabel(u), cell: (u) => <UploadStatus upload={u} onReview={review} /> },
  ]

  const exportCsv = () =>
    downloadCsv(
      exportName("uploads"),
      toCsv(
        uploads.map((u) => ({
          upload_id: u.code,
          file: u.fileName,
          type: UPLOAD_SPECS[u.type].label,
          uploaded_at: u.uploadedAt,
          uploaded_by: u.uploadedBy,
          rows: u.totalRows,
          saved: u.successRows,
          left_out: u.status === "needs_review" ? 0 : u.errorRows,
          status: statusLabel(u),
          summary: u.summary,
        })),
        ["upload_id", "file", "type", "uploaded_at", "uploaded_by", "rows", "saved", "left_out", "status", "summary"],
      ),
    )

  return (
    <>
      <PageHeader className="pt-4" title="Uploads" description="Send data into CrUber by CSV. Every row is checked, and you approve any fixes before anything is saved." />
      <Surface elevated className="p-4">
        <UploadPicker type={type} onTypeChange={setType} onUpload={upload} />
      </Surface>
      <div className="flex flex-col gap-3">
        <SectionTitle
          title="Your uploads"
          description={uploads.length ? uploads.length.toLocaleString("en-US") : undefined}
          actions={
            <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3" disabled={!uploads.length} onClick={exportCsv}>
              <Download className="size-4" /> Download CSV
            </Button>
          }
        />
        <DataTable
          rows={uploads}
          columns={columns}
          getRowId={(u) => u.id}
          onRowClick={(u) => setOpenId(u.id)}
          initialSort={{ id: "at", dir: "desc" }}
          pageSize={15}
          empty={<EmptyState icon={FileSpreadsheet} title="No uploads yet" description="Pick a type, choose a CSV and upload it. Every row is checked before anything is saved." />}
        />
      </div>
      <Dialog open={reviewing} onOpenChange={(o) => !o && closeReview()}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          {session && <ReviewFixes key={`${session.id}-${session.round}`} session={session} onChange={setSession} onDone={() => setReviewing(false)} />}
        </DialogContent>
      </Dialog>
      <UploadSheet upload={open} onOpenChange={(o) => !o && setOpenId(undefined)} onReview={review} />
    </>
  )
}

function UploadSheet({ upload, onOpenChange, onReview }: { upload?: Upload; onOpenChange: (open: boolean) => void; onReview: (u: Upload) => void }) {
  const waiting = upload?.status === "needs_review"
  return (
    <Sheet open={!!upload} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {upload && (
          <>
            <SheetHeader className="gap-1.5 border-b border-border px-6 pt-6 pb-5">
              <SheetTitle className="pr-6 text-featured-3 font-bold break-all">{upload.fileName}</SheetTitle>
              <SheetDescription className="text-body-3">
                {upload.code} · {UPLOAD_SPECS[upload.type].label} · {upload.uploadedBy} · {formatTimestamp(upload.uploadedAt)}
              </SheetDescription>
              <span className="pt-1">
                <UploadStatus upload={upload} />
              </span>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-6 py-5">
              <p className="text-body-3">{upload.summary}</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Rows", value: upload.totalRows },
                  { label: waiting ? "Ready" : "Saved", value: upload.successRows },
                  { label: waiting ? "To review" : "Left out", value: upload.errorRows },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border px-3 py-2.5">
                    <p className="text-featured-3 font-bold tabular">{s.value.toLocaleString("en-US")}</p>
                    <p className="text-caption-1 text-faded">{s.label}</p>
                  </div>
                ))}
              </div>
              {upload.issues.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-caption-1 font-medium text-faded">{waiting ? "Waiting for your review" : "Fixes and notes"}</h4>
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {upload.issues.map((i, k) => {
                      const Icon = waiting ? TriangleAlert : i.level === "error" ? CircleX : i.suggestion ? CircleCheck : Info
                      return (
                        <li key={k} className="flex items-start gap-3 px-3 py-2.5">
                          <Icon
                            className={cn(
                              "mt-0.5 size-4 shrink-0",
                              waiting ? "text-warning-fg" : i.level === "error" ? "text-critical-fg" : i.suggestion ? "text-positive-fg" : "text-subtle",
                            )}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="text-caption-1 font-semibold text-faded">
                              Row {i.row} · {columnLabel(upload.type, i.column)}
                            </span>
                            <span className="text-body-3 break-words">
                              {i.message}
                              {i.suggestion && <span className="text-faded"> → {i.suggestion.label}</span>}
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {waiting && (
                  <Button className="h-9 rounded-lg text-body-3 font-semibold" onClick={() => onReview(upload)}>
                    Review fixes
                  </Button>
                )}
                {upload.csv && (
                  <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => downloadCsv(upload.fileName, upload.csv!)}>
                    <Download className="size-4" /> Download file
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

"use client"

import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { useWorkspace } from "@/hooks/use-app"
import { UPLOAD_SPECS, applyFixes, fixOutcomes, planImport, reviewItems, type FixDecisions, type ImportPlan } from "@/lib/csv"
import { plural } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Upload, UploadIssue, UploadStatus, UploadType } from "@/lib/types"

/** A file waiting on reviewed fixes. Each save writes the decisions in and re-plans what's left. */
export interface ReviewSession {
  id: string
  type: UploadType
  fileName: string
  /** The file as it was uploaded. */
  original: string
  /** The rows still in play, with fixes from earlier rounds written in. */
  csv: string
  rowNumbers: number[]
  plan: ImportPlan
  total: number
  rejected: number
  history: UploadIssue[]
  round: number
  uploadId?: string
}

const MAX_KEPT_FILE = 200_000

const kept = (csv: string) => (csv.length <= MAX_KEPT_FILE ? csv : undefined)

const notes = (plan: ImportPlan) => plan.rows.flatMap((r) => r.issues.filter((i) => i.level === "warning"))

export type SubmitResult = { status: "saved" | "failed" } | { status: "review"; session: ReviewSession }

const session = (type: UploadType, fileName: string, csv: string, plan: ImportPlan, total: number, uploadId?: string): ReviewSession => ({
  id: `${uploadId ?? type}-${Date.now()}`,
  type,
  fileName,
  original: csv,
  csv,
  rowNumbers: plan.rows.map((r) => r.row),
  plan,
  total,
  rejected: 0,
  history: [],
  round: 0,
  uploadId,
})

export function useUploadFlow() {
  const router = useRouter()
  const pathname = usePathname()
  const { ws } = useWorkspace()

  const base = (type: UploadType, fileName: string) => ({
    type,
    fileName,
    uploadedBy: ws.user.name,
    actorKind: ws.kind,
    buyerId: ws.buyerId,
    supplierId: ws.supplierId,
    uploadedAt: new Date().toISOString(),
  })

  const announce = (type: UploadType, fileName: string, summary: string) => {
    const href = UPLOAD_SPECS[type].href
    toast.success(`Saved ${fileName}`, {
      description: summary,
      action: href && href !== pathname ? { label: "View", onClick: () => router.push(href) } : undefined,
    })
  }

  /** Saves a clean file at once and records one that can't be read. Anything else comes back to review. */
  const submit = (type: UploadType, fileName: string, csv: string): SubmitResult => {
    const { data, commitUpload } = useStore.getState()
    const plan = planImport(type, csv, data, ws)
    if (!plan.rows.length || plan.missingColumns.length) {
      commitUpload({
        ...base(type, fileName),
        status: "failed",
        totalRows: plan.rows.length,
        successRows: 0,
        errorRows: plan.rows.length,
        issues: [{ row: 1, message: plan.summary, level: "error" }],
        summary: plan.summary,
        csv: kept(csv),
      })
      toast.error(`Couldn't read ${fileName}`, { description: plan.rows.length ? `${plan.summary}. Download the template to see every column.` : "The file has no rows." })
      return { status: "failed" }
    }
    if (!plan.errorCount) {
      commitUpload(
        { ...base(type, fileName), status: "completed", totalRows: plan.rows.length, successRows: plan.okCount, errorRows: 0, issues: notes(plan).slice(0, 250), summary: plan.summary, csv: kept(csv) },
        plan.apply,
      )
      announce(type, fileName, plan.summary)
      return { status: "saved" }
    }
    return { status: "review", session: session(type, fileName, csv, plan, plan.rows.length) }
  }

  /** Reopens a file that was left waiting for review, re-checked against today's data. */
  const resume = (upload: Upload): ReviewSession | undefined => {
    if (!upload.csv) {
      toast.error("This file isn't available anymore", { description: "Upload it again to review it." })
      return undefined
    }
    const plan = planImport(upload.type, upload.csv, useStore.getState().data, ws)
    return session(upload.type, upload.fileName, upload.csv, plan, upload.totalRows, upload.id)
  }

  /** Closing without saving keeps a new file in the uploads table, waiting for review. */
  const hold = (s: ReviewSession) => {
    if (s.uploadId) return
    const { okCount, errorCount } = s.plan
    useStore.getState().commitUpload({
      ...base(s.type, s.fileName),
      status: "needs_review",
      totalRows: s.total,
      successRows: okCount,
      errorRows: errorCount,
      issues: reviewItems(s.plan).map((i) => i.issue).slice(0, 250),
      summary: `${plural(okCount, "row")} ready, ${errorCount} to review`,
      csv: s.csv,
    })
    toast(`${s.fileName} is waiting for your review`, {
      description: "Nothing was saved yet.",
      action: pathname !== "/uploads" ? { label: "Open Uploads", onClick: () => router.push("/uploads") } : undefined,
    })
  }

  /** Writes the decisions in and re-plans. Returns the next round while rows still have problems; otherwise saves. */
  const save = (s: ReviewSession, decisions: FixDecisions): ReviewSession | undefined => {
    const { data, commitUpload, resolveUpload } = useStore.getState()
    const items = reviewItems(s.plan)
    const fixed = applyFixes(s.csv, items, decisions, s.rowNumbers)
    const plan = planImport(s.type, fixed.csv, data, ws, fixed.rowNumbers)
    const history = [...s.history, ...fixOutcomes(items, decisions)]
    const rejected = s.rejected + fixed.rejected
    if (!plan.rows.length) return s
    if (plan.errorCount) return { ...s, csv: fixed.csv, rowNumbers: fixed.rowNumbers, plan, rejected, history, round: s.round + 1 }
    const status: UploadStatus = rejected ? "completed_with_errors" : "completed"
    const summary = rejected ? `${plan.summary}, ${plural(rejected, "row")} left out` : plan.summary
    const record = { status, totalRows: s.total, successRows: plan.okCount, errorRows: rejected, issues: [...history, ...notes(plan)].slice(0, 250), summary, csv: kept(s.original) }
    if (s.uploadId) resolveUpload(s.uploadId, record, plan.apply)
    else commitUpload({ ...base(s.type, s.fileName), ...record }, plan.apply)
    announce(s.type, s.fileName, summary)
    return undefined
  }

  return { submit, resume, hold, save }
}

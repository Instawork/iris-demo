"use client"

import { toast } from "sonner"
import { create } from "zustand"

import { emptyData, type BookingInput, type RateCardInput } from "@/lib/domain/core"
import type { ApproveResult, CommandInput, CommandName, CommandResult, Notice, UploadApply } from "@/lib/domain/commands"
import { applyChanges, type Changes } from "@/lib/domain/sync"
import { DEFAULT_WORKSPACE_ID, workspace } from "@/lib/reference"
import type { DemoData, RequirementId, RosterStatus, Upload } from "@/lib/types"

export { eligiblePros, emptyData, joinNames, notifiedSuppliers, supplierReleasePlan } from "@/lib/domain/core"
export type { BookingInput, Patch, RateCardInput } from "@/lib/domain/core"

type UploadRecord = Omit<Upload, "id" | "code">

export type TimesInput = { clockIn: string; clockOut: string; breakMins: number }

export type Connection = "connecting" | "live" | "offline"

interface StoreState {
  ready: boolean
  connection: Connection
  workspaceId: string
  /** Version of the server data this copy reflects. Changes apply in order; a gap reloads everything. */
  version: number
  data: DemoData
  connect: () => void
  resetDemo: () => Promise<void>
  setAgencyAutoFill: (supplierId: string, enabled: boolean) => Promise<void>
  signOut: () => Promise<void>
  setWorkspace: (id: string) => Promise<void>
  bookShifts: (input: BookingInput, key?: string) => Promise<string[]>
  decideApproval: (groupIds: string[], decision: "approve" | "decline", note?: string) => Promise<number>
  releaseNextTier: (groupId: string) => Promise<string | null>
  cancelGroup: (groupId: string) => Promise<void>
  setHeadcount: (groupId: string, headcount: number) => Promise<void>
  setSupplierApproval: (buyerId: string, supplierId: string, approved: boolean) => Promise<void>
  moveSupplierPriority: (buyerId: string, supplierId: string, direction: -1 | 1) => Promise<void>
  assignPros: (groupId: string, proIds: string[]) => Promise<number>
  releasePro: (groupId: string, slotId: string) => Promise<void>
  markNoShow: (groupId: string, slotId: string) => Promise<void>
  setRoster: (buyerId: string, proIds: string[], status: RosterStatus | null) => Promise<void>
  /** Approves pending hours onto this week's open invoice. A reason approves flagged ones as billed. Hours from a closed week are invoiced right away. */
  approveTimesheets: (ids: string[], reason?: string) => Promise<ApproveResult | undefined>
  /** Corrects a pending timesheet's billed times, then approves it. */
  correctTimesheet: (id: string, times: TimesInput, reason: string) => Promise<ApproveResult | undefined>
  rejectTimesheets: (ids: string[], reason: string, note?: string) => Promise<number>
  submitTimesheets: (ids: string[]) => Promise<number>
  withdrawTimesheets: (ids: string[]) => Promise<number>
  editTimesheet: (id: string, times: TimesInput, note?: string) => Promise<boolean>
  removeTimesheet: (id: string, reason: string) => Promise<boolean>
  setTips: (entries: { timesheetId: string; tips: number }[]) => Promise<void>
  createInvoiceGroup: (name: string, invoiceIds: string[]) => Promise<string>
  removeFromGroup: (invoiceId: string) => Promise<void>
  deleteInvoiceGroup: (groupId: string) => Promise<void>
  payInvoices: (ids: string[]) => Promise<void>
  /** Clears an invoice priced above the market for payment. */
  reviewInvoice: (id: string, note?: string) => Promise<void>
  /** Asks the agency to review the rates on this invoice that run above the market, and clears it for payment. Resolves to the number of rates. */
  requestRateReview: (id: string, note?: string) => Promise<number>
  answerRateReview: (cardId: string, decision: "lower" | "keep", note?: string) => Promise<boolean>
  /** Sends lines billed above Iris's clock back to the agency for a credit, or accepts them as billed. */
  decideBilling: (id: string, decision: "send_back" | "accept", note?: string) => Promise<boolean>
  /** The agency credits what Compass sent back. Resolves to the amount credited. */
  creditInvoice: (id: string) => Promise<number | undefined>
  /** Issues this week's open invoices now, for the presenter. Resolves to their numbers. */
  closeWeekNow: () => Promise<string[]>
  upsertRateCard: (input: RateCardInput) => Promise<void>
  deleteRateCard: (id: string) => Promise<void>
  completeRequirement: (proId: string, requirement: RequirementId) => Promise<void>
  addReview: (input: { proId: string; buyerId: string; groupId?: string; rating: number; text: string }) => Promise<void>
  /** Saves an upload. `apply` is the reviewed file, which the server checks again and applies. */
  commitUpload: (upload: UploadRecord, apply?: UploadApply) => Promise<Upload | undefined>
  /** Saves an upload that was waiting on reviewed fixes. */
  resolveUpload: (id: string, patch: Partial<UploadRecord>, apply?: UploadApply) => Promise<void>
}

interface ServerEvent {
  version: number
  changes?: Changes
  notices?: Notice[]
}

let source: EventSource | undefined
let resyncing: Promise<void> | undefined
let connecting = false

const signInAgain = () => {
  const next = `${window.location.pathname}${window.location.search}`
  window.location.href = new URL(`/sign-in${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`, window.location.origin).href
}

export const useStore = create<StoreState>()((set, get) => {
  const resync = () =>
    (resyncing ??= fetch("/api/state", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) return signInAgain()
        if (!res.ok) throw new Error(`Iris returned ${res.status}`)
        const body = (await res.json()) as { version: number; data: DemoData; workspaceId: string }
        set({ data: body.data, version: body.version, workspaceId: body.workspaceId, ready: true })
      })
      .finally(() => {
        resyncing = undefined
      }))

  /**
   * Waits until this device holds every change up to `version`, so whoever sent a command reads its effects next. A
   * reload already in flight may predate the command, hence the second try.
   */
  const caughtUp = async (version: number) => {
    for (let attempt = 0; attempt < 3 && get().version < version; attempt++) await resync()
  }

  const relevant = (notice: Notice) => {
    const ws = workspace(get().workspaceId)
    if (notice.workspaceIds) return notice.workspaceIds.includes(ws.id)
    if (notice.supplierId) return ws.supplierId === notice.supplierId
    if (notice.buyerId) return ws.kind === "compass" || ws.buyerId === notice.buyerId
    return true
  }

  const announce = (notices?: Notice[]) => {
    for (const notice of notices ?? []) {
      if (!relevant(notice)) continue
      if (notice.tone === "success") toast.success(notice.text, { duration: 6000 })
      else if (notice.tone === "warning") toast.warning(notice.text, { duration: 6000 })
      else toast(notice.text, { duration: 6000 })
    }
  }

  const receive = (event: ServerEvent, kind: "change" | "reset") => {
    if (kind === "reset") {
      void resync()
      return
    }
    const { version, data } = get()
    if (event.version <= version) return
    if (event.version !== version + 1 || !event.changes) {
      announce(event.notices)
      void resync()
      return
    }
    set({ data: applyChanges(data, event.changes), version: event.version })
    announce(event.notices)
  }

  const listen = () => {
    source?.close()
    source = new EventSource("/api/events")
    source.addEventListener("hello", (e) => {
      const { version } = JSON.parse((e as MessageEvent<string>).data) as { version: number }
      set({ connection: "live" })
      if (version !== get().version) void resync()
    })
    source.addEventListener("change", (e) => receive(JSON.parse((e as MessageEvent<string>).data) as ServerEvent, "change"))
    source.addEventListener("reset", (e) => receive(JSON.parse((e as MessageEvent<string>).data) as ServerEvent, "reset"))
    source.onerror = () => set({ connection: "offline" })
  }

  async function send<N extends CommandName>(type: N, input: CommandInput<N>, key?: string): Promise<CommandResult<N> | undefined> {
    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, input, key }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; result?: CommandResult<N>; version?: number; changes?: Changes; replaced?: boolean }
      if (res.status === 401) {
        signInAgain()
        return undefined
      }
      if (!res.ok) {
        toast.error(body.error ?? "Iris couldn't save that. Try again.")
        return undefined
      }
      if (body.replaced) await resync()
      else if (body.changes && body.version) {
        receive({ version: body.version, changes: body.changes }, "change")
        await caughtUp(body.version)
      }
      return body.result
    } catch {
      toast.error("Iris is offline. Check the connection and try again.")
      return undefined
    }
  }

  return {
    ready: false,
    connection: "connecting",
    workspaceId: DEFAULT_WORKSPACE_ID,
    version: 0,
    data: emptyData(),

    connect: () => {
      if (connecting) return
      connecting = true
      const attempt = () =>
        resync()
          .then(listen)
          .catch(() => {
            set({ connection: "offline" })
            window.setTimeout(attempt, 3000)
          })
      void attempt()
    },

    resetDemo: async () => {
      await send("resetDemo", {} as never)
    },

    setAgencyAutoFill: async (supplierId, enabled) => void (await send("setAgencyAutoFill", { supplierId, enabled })),

    signOut: async () => {
      source?.close()
      await fetch("/api/session", { method: "DELETE" }).catch(() => undefined)
      window.location.href = new URL("/sign-in", window.location.origin).href
    },

    setWorkspace: async (id) => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      }).catch(() => undefined)
      if (!res?.ok) {
        toast.error("Couldn't switch workspace. Try again.")
        return
      }
      set({ workspaceId: workspace(id).id })
      listen()
    },

    bookShifts: async (input, key) => (await send("createJobPosting", input, key)) ?? [],
    decideApproval: async (groupIds, decision, note) => (await send("decideApproval", { groupIds, decision, note })) ?? 0,
    releaseNextTier: async (groupId) => (await send("releaseNextTier", { groupId })) ?? null,
    cancelGroup: async (groupId) => void (await send("cancelGroup", { groupId })),
    setHeadcount: async (groupId, headcount) => void (await send("setHeadcount", { groupId, headcount })),
    setSupplierApproval: async (buyerId, supplierId, approved) => void (await send("setSupplierApproval", { buyerId, supplierId, approved })),
    moveSupplierPriority: async (buyerId, supplierId, direction) => void (await send("moveSupplierPriority", { buyerId, supplierId, direction })),
    assignPros: async (groupId, proIds) => (await send("assignPros", { groupId, proIds })) ?? 0,
    releasePro: async (groupId, slotId) => void (await send("releasePro", { groupId, slotId })),
    markNoShow: async (groupId, slotId) => void (await send("markNoShow", { groupId, slotId })),
    setRoster: async (buyerId, proIds, status) => void (await send("setRoster", { buyerId, proIds, status })),
    approveTimesheets: async (ids, reason) => send("approveTimesheets", { ids, reason }),
    correctTimesheet: async (id, times, reason) => send("correctTimesheet", { id, ...times, reason }),
    rejectTimesheets: async (ids, reason, note) => (await send("rejectTimesheets", { ids, reason, note })) ?? 0,
    submitTimesheets: async (ids) => (await send("submitTimesheets", { ids })) ?? 0,
    withdrawTimesheets: async (ids) => (await send("withdrawTimesheets", { ids })) ?? 0,
    editTimesheet: async (id, times, note) => (await send("editTimesheet", { id, ...times, note })) !== undefined,
    removeTimesheet: async (id, reason) => (await send("removeTimesheet", { id, reason })) !== undefined,
    setTips: async (entries) => void (await send("setTips", { entries })),
    createInvoiceGroup: async (name, invoiceIds) => (await send("createInvoiceGroup", { name, invoiceIds })) ?? "",
    removeFromGroup: async (invoiceId) => void (await send("removeFromGroup", { invoiceId })),
    deleteInvoiceGroup: async (groupId) => void (await send("deleteInvoiceGroup", { groupId })),
    payInvoices: async (ids) => void (await send("payInvoices", { ids })),
    reviewInvoice: async (id, note) => void (await send("reviewInvoice", { id, note })),
    requestRateReview: async (id, note) => (await send("requestRateReview", { id, note })) ?? 0,
    answerRateReview: async (cardId, decision, note) => (await send("answerRateReview", { id: cardId, decision, note })) !== undefined,
    decideBilling: async (id, decision, note) => (await send("decideBilling", { id, decision, note })) !== undefined,
    creditInvoice: async (id) => send("creditInvoice", { id }),
    closeWeekNow: async () => (await send("closeWeekNow", {} as never)) ?? [],
    upsertRateCard: async (input) => void (await send("upsertRateCard", input)),
    deleteRateCard: async (id) => void (await send("deleteRateCard", { id })),
    completeRequirement: async (proId, requirement) => void (await send("completeRequirement", { proId, requirement })),
    addReview: async (input) => void (await send("addReview", input)),
    commitUpload: async (upload, apply) => send("commitUpload", { upload, apply }),
    resolveUpload: async (id, patch, apply) => void (await send("resolveUpload", { id, patch, apply })),
  }
})

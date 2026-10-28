"use client"

import { toast } from "sonner"
import { create } from "zustand"

import { emptyData, type BookingInput, type RateCardInput } from "@/lib/domain/core"
import type { AgencyInput, ApproveResult, CommandInput, CommandName, CommandResult, Notice, UnitInput, UploadApply } from "@/lib/domain/commands"
import { applyChanges, type Changes } from "@/lib/domain/sync"
import { DEFAULT_WORKSPACE_ID, syncDirectory, workspace } from "@/lib/reference"
import type { DemoData, ReportSchedule, ReportSpec, RequirementId, RosterStatus, Upload, Verification } from "@/lib/types"

export { eligiblePros, emptyData, joinNames, notifiedSuppliers, pickedOffer, supplierReleasePlan } from "@/lib/domain/core"
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
  /** Saves a new report, or over `id`. Resolves to its id. */
  saveReport: (input: { id?: string; name: string; description?: string; spec: ReportSpec }) => Promise<string | undefined>
  deleteReport: (id: string) => Promise<boolean>
  scheduleReport: (id: string, schedule: Omit<ReportSchedule, "lastSentAt"> | null) => Promise<boolean>
  /** Emails a report now, to these people or its schedule's. Resolves to how many it went to. */
  sendReport: (id: string, recipients?: string[]) => Promise<number>
  /** Adds a unit to a buyer. Resolves to its location id. */
  onboardUnit: (input: UnitInput) => Promise<string | undefined>
  /** Adds an agency with its rate card and Pros. Resolves to its id. */
  onboardAgency: (input: AgencyInput) => Promise<string | undefined>
  signOut: () => Promise<void>
  setWorkspace: (id: string) => Promise<void>
  bookShifts: (input: BookingInput, key?: string) => Promise<string[]>
  decideApproval: (groupIds: string[], decision: "approve" | "decline", note?: string) => Promise<number>
  releaseNextTier: (groupId: string) => Promise<string | null>
  cancelGroup: (groupId: string) => Promise<void>
  setHeadcount: (groupId: string, headcount: number) => Promise<void>
  setSupplierApproval: (buyerId: string, supplierId: string, approved: boolean) => Promise<void>
  /** Picks the agency that sees a role's new shifts first in a market. `null` goes back to lowest rate first. */
  pickOffer: (buyerId: string, cityId: string, positionId: string, supplierId: string | null) => Promise<void>
  assignPros: (groupId: string, proIds: string[]) => Promise<number>
  releasePro: (groupId: string, slotId: string) => Promise<void>
  markNoShow: (groupId: string, slotId: string) => Promise<void>
  /** Moves a worker to another role from a time during the shift. Resolves to the new role's bill rate. */
  moveToRole: (input: { groupId: string; slotId: string; positionId: string; at: string; note?: string }) => Promise<{ positionId: string; billRate: number; split: boolean } | undefined>
  /** Turns automatic submission on or off for an agency. Resolves to how many waiting drafts went in. */
  setAutoSubmit: (supplierId: string, enabled: boolean) => Promise<number | undefined>
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
  createSourcingEvent: (input: { cityId: string; positionIds: string[]; supplierIds: string[]; closesOn: string; title?: string }) => Promise<string | undefined>
  submitBid: (eventId: string, lines: Record<string, { proRate: number; markupPct: number }>, note?: string) => Promise<number | undefined>
  counterBid: (eventId: string, supplierId: string, lineId: string, ask: number, note?: string) => Promise<boolean>
  approveBids: (eventId: string, supplierIds: string[]) => Promise<number>
  /** Sends lines billed above Iris's clock back to the agency for a credit, or accepts them as billed. */
  decideBilling: (id: string, decision: "send_back" | "accept", note?: string) => Promise<boolean>
  /** The agency credits what Compass sent back. Resolves to the amount credited. */
  creditInvoice: (id: string) => Promise<number | undefined>
  /** Issues this week's open invoices now, for the presenter. Resolves to their numbers. */
  closeWeekNow: () => Promise<string[]>
  upsertRateCard: (input: RateCardInput) => Promise<void>
  deleteRateCard: (id: string) => Promise<void>
  completeRequirement: (proId: string, requirement: RequirementId) => Promise<void>
  /** The agency attests a document and Iris checks it with the issuer. Resolves to what the issuer said. */
  verifyRequirement: (
    proId: string,
    requirement: RequirementId,
    doc: { provider: string; reference: string; issuedOn: string; expiresOn?: string; file?: string },
  ) => Promise<{ result: Verification["result"]; reason?: string } | undefined>
  /** Compass compliance accepts or sends back a document Iris couldn't verify. */
  reviewDocument: (proId: string, requirement: RequirementId, decision: "accept" | "reject", note?: string) => Promise<boolean>
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
        syncDirectory(body.data.directory)
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
    const next = applyChanges(data, event.changes)
    if (next.directory !== data.directory) syncDirectory(next.directory)
    set({ data: next, version: event.version })
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

  /** Brings this device up to `version` after a saved command. It's already saved, so a slow reload retries quietly. */
  const settle = async (body: { version?: number; changes?: Changes; replaced?: boolean }) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (body.replaced) await resync()
        else if (body.changes && body.version) {
          receive({ version: body.version, changes: body.changes }, "change")
          await caughtUp(body.version)
        }
        return
      } catch (error) {
        console.warn("Iris is catching up after a saved change", error)
        await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)))
      }
    }
  }

  async function send<N extends CommandName>(type: N, input: CommandInput<N>, key?: string): Promise<CommandResult<N> | undefined> {
    let res: Response
    try {
      res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, input, key }),
      })
    } catch {
      toast.error("Iris is offline. Check the connection and try again.")
      return undefined
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; result?: CommandResult<N>; version?: number; changes?: Changes; replaced?: boolean }
    if (res.status === 401) {
      signInAgain()
      return undefined
    }
    if (!res.ok) {
      toast.error(body.error ?? "Iris couldn't save that. Try again.")
      return undefined
    }
    await settle(body)
    return body.result
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
    saveReport: async (input) => send("saveReport", input),
    deleteReport: async (id) => (await send("deleteReport", { id })) !== undefined,
    scheduleReport: async (id, schedule) => (await send("scheduleReport", { id, schedule })) !== undefined,
    sendReport: async (id, recipients) => (await send("sendReport", { id, recipients })) ?? 0,
    onboardUnit: async (input) => send("onboardUnit", input),
    onboardAgency: async (input) => send("onboardAgency", input),

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
    pickOffer: async (buyerId, cityId, positionId, supplierId) => void (await send("pickOffer", { buyerId, cityId, positionId, supplierId })),
    assignPros: async (groupId, proIds) => (await send("assignPros", { groupId, proIds })) ?? 0,
    releasePro: async (groupId, slotId) => void (await send("releasePro", { groupId, slotId })),
    markNoShow: async (groupId, slotId) => void (await send("markNoShow", { groupId, slotId })),
    moveToRole: async (input) => send("moveToRole", input),
    setAutoSubmit: async (supplierId, enabled) => send("setAutoSubmit", { supplierId, enabled }),
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
    createSourcingEvent: async (input) => send("createSourcingEvent", input),
    submitBid: async (eventId, lines, note) => send("submitBid", { eventId, lines, note }),
    counterBid: async (eventId, supplierId, lineId, ask, note) => (await send("counterBid", { eventId, supplierId, lineId, ask, note })) !== undefined,
    approveBids: async (eventId, supplierIds) => (await send("approveBids", { eventId, supplierIds })) ?? 0,
    decideBilling: async (id, decision, note) => (await send("decideBilling", { id, decision, note })) !== undefined,
    creditInvoice: async (id) => send("creditInvoice", { id }),
    closeWeekNow: async () => (await send("closeWeekNow", {} as never)) ?? [],
    upsertRateCard: async (input) => void (await send("upsertRateCard", input)),
    deleteRateCard: async (id) => void (await send("deleteRateCard", { id })),
    completeRequirement: async (proId, requirement) => void (await send("completeRequirement", { proId, requirement })),
    verifyRequirement: async (proId, requirement, doc) => send("verifyRequirement", { proId, requirement, ...doc, attested: true }),
    reviewDocument: async (proId, requirement, decision, note) => (await send("reviewDocument", { proId, requirement, decision, note })) !== undefined,
    addReview: async (input) => void (await send("addReview", input)),
    commitUpload: async (upload, apply) => send("commitUpload", { upload, apply }),
    resolveUpload: async (id, patch, apply) => void (await send("resolveUpload", { id, patch, apply })),
  }
})

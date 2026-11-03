"use client"

import { useCallback, useRef } from "react"

import { NO_MESSAGES, useAgentThreads, type AgentAction, type AgentMessage } from "@/components/agent/agent-store"
import { useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import { asksToAssign, asksToExpense, asksToSubmit, assignReply, expenseReply, submitFrom, submitReply, submittedLine } from "@/lib/agent-agency"
import { approvedLine, correctedLine, hoursReply, parseHoursApproval } from "@/lib/agent-hours"
import { parseReportRequest, reportReply } from "@/lib/agent-report"
import { asksToTip, tipsReply } from "@/lib/agent-tips"
import { looksLikeShiftRequest, parseAgentShift, type ParsedAgentShift } from "@/lib/agent-shift"
import { UPLOAD_SPECS, downloadCsv, planImport, specsFor, templateCsv, templateName } from "@/lib/csv"
import { formatClockShort, formatDay, formatTimestamp, paidHours, todayISO } from "@/lib/dates"
import { previewOrder } from "@/lib/domain/order"
import { money, round2 } from "@/lib/format"
import { PROGRAM, approversFor, departmentOf, location, locationsFor, policyFor, position, supplier } from "@/lib/reference"
import { detectUploadType, isSpreadsheetFile, spreadsheetToCsv } from "@/lib/spreadsheet"
import { EXPENSE_LABEL } from "@/lib/timesheets"
import { joinNames, notifiedSuppliers, pickedOffer, useStore, type BookingInput } from "@/lib/store"
import type { DemoData, UploadType } from "@/lib/types"

export const AGENT_FILE_ACCEPT =
  ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"

/** Iris's agent: turns a sentence or a spreadsheet into a reviewed draft. Nothing is saved until the user approves it. */
export function useAgent() {
  const { ws } = useWorkspace()
  const messages = useAgentThreads((state) => state.threads[ws.id] ?? NO_MESSAGES)
  const push = useAgentThreads((state) => state.push)
  const reply = useAgentThreads((state) => state.reply)
  const thinking = useAgentThreads((state) => !!state.thinking[ws.id])
  const clearThread = useAgentThreads((state) => state.clear)
  const dropActions = useAgentThreads((state) => state.dropActions)
  const setOpen = useUi((state) => state.setAgentOpen)
  const openUpload = useUi((state) => state.openUpload)
  const stageUpload = useUi((state) => state.stageUpload)
  const approving = useRef(new Set<number>())

  const add = useCallback((message: Parameters<typeof push>[1]) => (message.from === "agent" ? void reply(ws.id, message) : push(ws.id, message)), [push, reply, ws.id])

  const proposeShift = useCallback(
    (request: ParsedAgentShift) => {
      const pos = position(request.positionId)
      add(
        shiftDraft(useStore.getState().data, ws.buyerId!, {
          locationId: request.locationId,
          positionId: request.positionId,
          dates: [request.date],
          start: request.start,
          end: request.end,
          breakMins: request.breakMins,
          headcount: request.headcount,
          instructions: pos.duties,
          attire: pos.attire,
          tips: pos.alcohol,
        }),
      )
    },
    [add, ws.buyerId],
  )

  /** Redrafts an unsent order with this agency first. */
  const pickFirst = useCallback(
    (messageId: number, supplierId: string) => {
      const message = (useAgentThreads.getState().threads[ws.id] ?? []).find((m) => m.id === messageId)
      const action = message?.actions?.find((a) => a.kind === "create-shift")
      if (!message || !action || action.kind !== "create-shift") return
      const next = shiftDraft(useStore.getState().data, ws.buyerId!, { ...action.input, firstAgencyId: supplierId })
      useAgentThreads.getState().update(ws.id, messageId, { text: next.text, draft: next.draft, actions: next.actions })
    },
    [ws.id, ws.buyerId],
  )

  const respond = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text) return
      add({ from: "user", text })
      const lower = text.toLowerCase()

      if (ws.kind === "buyer") {
        const data = useStore.getState().data
        if (asksToTip(text)) {
          const onScreen = /^\/shifts\/(?!new$)([^/]+)$/.exec(window.location.pathname)?.[1] ?? (window.location.pathname === "/timesheets" ? (new URLSearchParams(window.location.search).get("shift") ?? undefined) : undefined)
          add({ from: "agent", ...tipsReply(data, ws.buyerId!, text, todayISO(), onScreen) })
          return
        }
        const request = parseHoursApproval(text, data, ws.buyerId!, todayISO())
        if (request?.ambiguous.length) {
          const names = request.ambiguous
          add({ from: "agent", text: `${joinNames(names)} ${names.length === 2 ? "both" : "all"} have timesheets with you. Which one did you mean?` })
          return
        }
        if (request) {
          add({ from: "agent", ...hoursReply(data, ws.buyerId!, request.scope, todayISO()) })
          return
        }
      }

      if (ws.kind === "supplier" && ws.supplierId) {
        const data = useStore.getState().data
        if (asksToExpense(text)) {
          const onScreen = /^\/shifts\/(?!new$)([^/]+)$/.exec(window.location.pathname)?.[1] ?? (window.location.pathname === "/timesheets" ? (new URLSearchParams(window.location.search).get("shift") ?? undefined) : undefined)
          add({ from: "agent", ...expenseReply(data, ws.supplierId, text, todayISO(), onScreen) })
          return
        }
        if (asksToSubmit(text)) {
          add({ from: "agent", ...submitReply(data, ws.supplierId, submitFrom(text, todayISO())) })
          return
        }
        if (asksToAssign(text)) {
          add({ from: "agent", ...assignReply(data, ws.supplierId) })
          return
        }
      }

      const report = parseReportRequest(text, ws)
      if (report) {
        add({ from: "agent", ...reportReply(useStore.getState().data, report, ws) })
        return
      }

      const parsed = ws.kind === "buyer" ? parseAgentShift(text, ws.buyerId!) : undefined
      if (ws.kind === "buyer" && parsed && (parsed.draft || looksLikeShiftRequest(text))) {
        const buyerId = ws.buyerId!
        if (!parsed.draft) {
          add({
            from: "agent",
            text: `I still need the ${parsed.missing.join(", ")}. Include them in one sentence, for example: “12 bartenders at ${locationsFor(buyerId)[0].name} Sunday 2pm to 11:30pm.” I’ll use ${locationsFor(buyerId)[0].name} unless you name another location.`,
          })
          return
        }
        proposeShift(parsed.draft)
        return
      }

      if (lower.includes("template")) {
        const type: UploadType =
          lower.includes("rate") ? "rates" : lower.includes("professional") ? "professionals" : lower.includes("hour") ? "timesheets" : lower.includes("tip") ? "tips" : lower.includes("expense") && ws.kind === "supplier" ? "expenses" : ws.kind === "compass" ? "activity" : "shifts"
        add({
          from: "agent",
          text: `Here is the ${UPLOAD_SPECS[type].label.toLowerCase()} template. It contains the exact columns the validator expects.`,
          actions: [{ label: `Download ${UPLOAD_SPECS[type].label.toLowerCase()} template`, kind: "template", type }],
        })
        return
      }

      if (lower.includes("upload")) {
        add({
          from: "agent",
          text: "Attach a CSV or Excel file here. I’ll identify the upload type, check its structure, and explain any fixes before data is saved.",
          actions: [{ label: "Choose attachment", kind: "upload" }],
        })
        return
      }

      if (lower.includes("invoice")) {
        add({ from: "agent", text: "Flagged invoices are priced above comparable agency rates for the same hours. Open the review queue to inspect line items, peer rates and the amount at risk.", actions: [{ label: "Review flagged invoices", kind: "link", href: "/invoices?filter=flagged" }] })
        return
      }

      if (lower.includes("safety") || lower.includes("document") || lower.includes("background")) {
        add({ from: "agent", text: "Safety exceptions include pending background checks, I-9s, orientation, and missing or expired role documents. Workers stay off shifts until their requirements are current.", actions: [{ label: "Review worker compliance", kind: "link", href: "/professionals?filter=not_compliant" }] })
        return
      }

      if (lower.includes("hour") || lower.includes("timesheet")) {
        const reply =
          ws.kind === "buyer"
            ? "Every timesheet is checked against Iris's clock. Ask me to approve them, like “approve yesterday's hours” or “approve Harbor's timesheets for this week”, or attach a timesheet CSV and Iris will check it."
            : ws.kind === "supplier"
              ? "Iris drafts your timesheets from its clock. Ask me to submit them, like “submit this week's timesheets”, or attach a timesheet CSV and Iris will check it."
              : "Each buyer approves its own hours, after Iris checks them against its clock. Open Timesheets to see them across the program."
        add({ from: "agent", text: reply, actions: [{ label: "Open timesheets", kind: "link", href: "/timesheets" }, { label: "Upload timesheets", kind: "upload", type: "timesheets" }] })
        return
      }

      if (lower.includes("assign") || lower.includes("staff")) {
        add({ from: "agent", text: "Open Shifts to see every spot still waiting on a worker. Each shift shows which of your workers are cleared for the role.", actions: [{ label: "Open Shifts", kind: "link", href: "/shifts" }] })
        return
      }

      add({
        from: "agent",
        text: `I can ${ws.kind === "buyer" ? "create a shift from one sentence, " : ""}build a report from a question like “spend by agency last month”, give you the right CSV template, or check an attachment before anything is saved. Try one of the suggestions, or describe what you need.`,
      })
    },
    [add, proposeShift, ws],
  )

  const attach = useCallback(
    async (file?: File) => {
      if (!file) return
      add({ from: "user", text: "Attached a file for review.", fileName: file.name })
      if (!isSpreadsheetFile(file)) {
        add({ from: "agent", text: "I can read CSV and Excel (.xlsx) spreadsheets. Choose one of those and I’ll validate every row before anything is saved." })
        return
      }
      let csv = ""
      try {
        csv = await spreadsheetToCsv(file)
      } catch (error) {
        add({ from: "agent", text: error instanceof Error ? error.message : "I couldn't read that spreadsheet. Try exporting its first sheet as CSV." })
        return
      }
      const detected = detectUploadType(csv, ws.kind)
      if (!detected.type || detected.ambiguous) {
        add({
          from: "agent",
          text: "I can’t determine this file type with enough confidence. Choose what the rows represent; I’ll run the matching validation next. Nothing has been saved.",
          actions: specsFor(ws.kind).map((spec) => ({ label: spec.label, kind: "review" as const, type: spec.type, fileName: file.name, csv })),
        })
        return
      }
      const type = detected.type
      const plan = planImport(type, csv, useStore.getState().data, ws)
      add({
        from: "agent",
        text: `I identified this as ${/^[aeiou]/i.test(UPLOAD_SPECS[type].label) ? "an" : "a"} ${UPLOAD_SPECS[type].label.toLowerCase()} upload. ${plan.okCount} row${plan.okCount === 1 ? "" : "s"} ready, ${plan.errorCount} requiring review${plan.missingColumns.length ? `, and ${plan.missingColumns.length} required column${plan.missingColumns.length === 1 ? "" : "s"} missing` : ""}. Nothing has been saved.`,
        actions: [
          { label: "Continue to upload review", kind: "review", type, fileName: file.name, csv },
          { label: "Download matching template", kind: "template", type },
        ],
      })
    },
    [add, ws],
  )

  const runAction = useCallback(
    async (action: AgentAction, messageId?: number) => {
      if (action.kind === "template") {
        downloadCsv(templateName(action.type), templateCsv(action.type, useStore.getState().data, ws))
        return
      }
      if (action.kind === "upload") {
        if (action.type) {
          setOpen(false)
          openUpload(action.type)
        } else [...document.querySelectorAll<HTMLInputElement>("input[data-agent-file]")].at(-1)?.click()
        return
      }
      if (action.kind === "review") {
        stageUpload({ id: `upload-${useAgentThreads.getState().nextId}`, type: action.type, fileName: action.fileName, csv: action.csv })
        setOpen(false)
        openUpload(action.type)
        return
      }
      if (action.kind === "approve-timesheets" || action.kind === "accept-proposal") {
        const key = messageId ?? 0
        if (approving.current.has(key)) return
        approving.current.add(key)
        try {
          const store = useStore.getState()
          const ids = action.kind === "approve-timesheets" ? action.ids : [action.id]
          const before = store.data.timesheets.filter((t) => ids.includes(t.id) && t.status === "pending_approval")
          const result = action.kind === "approve-timesheets" ? await store.approveTimesheets(action.ids) : await store.correctTimesheet(action.id, action.times, action.reason)
          if (!result) return
          if (messageId) dropActions(ws.id, messageId)
          const data = useStore.getState().data
          const today = todayISO()
          const lead =
            action.kind === "accept-proposal" && before[0]
              ? correctedLine(before[0], action.hours, action.reason, data, result, today)
              : approvedLine(
                  data.timesheets.filter((t) => before.some((b) => b.id === t.id) && (t.status === "approved" || t.status === "invoiced")),
                  result,
                  today,
                )
          if (action.kind === "accept-proposal" && messageId) {
            const card = hoursReply(data, ws.buyerId!, action.scope, today)
            if (card.batch) {
              useAgentThreads.getState().update(ws.id, messageId, { text: card.text, actions: card.actions, batch: card.batch })
              add({ from: "agent", text: lead })
              return
            }
          }
          const next = hoursReply(data, ws.buyerId!, action.scope, today, true)
          add({ from: "agent", text: `${lead}\n\n${next.text}`, actions: next.actions, batch: next.batch })
        } finally {
          approving.current.delete(key)
        }
        return
      }
      if (action.kind === "add-expenses") {
        const key = messageId ?? 0
        if (approving.current.has(key)) return
        approving.current.add(key)
        try {
          const n = await useStore.getState().addExpenses(action.ids, action.expense, action.amount, action.note)
          if (!n) return
          if (messageId) dropActions(ws.id, messageId)
          add({
            from: "agent",
            text: `Added ${money(action.amount)} ${EXPENSE_LABEL[action.expense].toLowerCase()} to ${n} timesheet${n === 1 ? "" : "s"}.`,
            actions: [{ label: "Open timesheets", kind: "link", href: "/timesheets" }],
          })
        } finally {
          approving.current.delete(key)
        }
        return
      }
      if (action.kind === "set-tips") {
        const key = messageId ?? 0
        if (approving.current.has(key)) return
        approving.current.add(key)
        try {
          if (!(await useStore.getState().setTips(action.entries))) return
          if (messageId) dropActions(ws.id, messageId)
          add({
            from: "agent",
            text: `Added ${money(action.total)} in tips for ${action.entries.length} worker${action.entries.length === 1 ? "" : "s"}.`,
          })
        } finally {
          approving.current.delete(key)
        }
        return
      }
      if (action.kind === "submit-timesheets" || action.kind === "assign-workers") {
        const key = messageId ?? 0
        if (approving.current.has(key) || !ws.supplierId) return
        approving.current.add(key)
        try {
          const store = useStore.getState()
          if (action.kind === "submit-timesheets") {
            const n = await store.submitTimesheets(action.ids)
            if (!n) return
            if (messageId) dropActions(ws.id, messageId)
            const data = useStore.getState().data
            const sent = data.timesheets.filter((t) => action.ids.includes(t.id) && t.status === "pending_approval")
            const next = submitReply(data, ws.supplierId, action.from, true)
            add({ from: "agent", text: `${submittedLine(sent)}\n\n${next.text}`, actions: next.actions, batch: next.batch })
            return
          }
          let placed = 0
          for (const p of action.plan) placed += await store.assignPros(p.groupId, p.proIds)
          if (!placed) return
          if (messageId) dropActions(ws.id, messageId)
          const shifts = action.plan.length
          const next = assignReply(useStore.getState().data, ws.supplierId, true)
          add({
            from: "agent",
            text: `Assigned ${placed} worker${placed === 1 ? "" : "s"} across ${shifts} shift${shifts === 1 ? "" : "s"}. Each one is confirmed and the buyers can see who's coming.\n\n${next.text}`,
            actions: [...next.actions, { label: "Open Shifts", kind: "link", href: "/shifts" }],
          })
        } finally {
          approving.current.delete(key)
        }
        return
      }
      if (action.kind === "create-shift") {
        const ids = await useStore.getState().bookShifts(action.input, action.key)
        if (!ids.length) return
        if (messageId) dropActions(ws.id, messageId)
        const pos = position(action.input.positionId)
        const created = useStore.getState().data.groups.find((group) => group.id === ids[0])
        const spots = `${action.input.headcount} ${pos.name} spot${action.input.headcount === 1 ? "" : "s"}`
        const approver = created ? approversFor(created.locationId)[0] : undefined
        const later = (created?.supplierReleases ?? []).slice(1).map((r) => supplier(r.supplierId).shortName)
        const text =
          created?.approval?.status === "pending"
            ? `Sent ${spots} to ${approver?.user.name ?? "your approver"} for approval. Agencies see it the moment it's approved.`
            : created && !created.supplierIds.length && created.supplierReleases?.[0]
              ? `Posted ${spots}. ${supplier(created.supplierId).shortName} sees it ${formatTimestamp(created.supplierReleases[0].releasedAt)}, when ${policyFor(created.buyerId).sector} releases it.`
              : `Posted ${spots}. ${created ? supplier(created.supplierId).shortName : "Your first agency"} has them now${
                  later.length ? `, and ${joinNames(later)} ${later.length === 1 ? "gets" : "get"} whatever's still open, ${policyFor(created?.buyerId ?? "").tierGapHours} hours apart` : ""
                }.`
        add({ from: "agent", text, actions: [{ label: "View created shift", kind: "link", href: `/shifts/${ids[0]}` }] })
        return
      }
      setOpen(false)
    },
    [add, dropActions, openUpload, setOpen, stageUpload, ws],
  )

  /** A prediction the user accepted: show their ask, then the same reviewed draft a typed request would get. */
  const draftShift = useCallback(
    (ask: string, request: ParsedAgentShift) => {
      add({ from: "user", text: ask })
      proposeShift(request)
    },
    [add, proposeShift],
  )

  const clear = useCallback(() => clearThread(ws.id), [clearThread, ws.id])

  return { messages, thinking, respond, attach, runAction, draftShift, pickFirst, clear }
}

/** The draft card for an order: priced at each agency's rate, charged to its department, in release order. */
function shiftDraft(data: DemoData, buyerId: string, input: BookingInput): Omit<AgentMessage, "id"> {
  const loc = location(input.locationId)
  const pos = position(input.positionId)
  const hours = paidHours(input.start, input.end, input.breakMins)
  const quotes = notifiedSuppliers(data, buyerId, loc.cityId, input.positionId, input.firstAgencyId)
  if (!quotes.length) return { from: "agent", text: `None of your approved agencies currently staff ${pos.name} in ${loc.name}. Approve a matching agency before posting this shift.` }
  const totals = quotes.map(({ card }) => round2(card.billRate * hours * input.headcount))
  const preview = previewOrder(data, input)
  const department = departmentOf(loc.id, input.departmentId, input.positionId)
  const held = preview?.held && preview.firstRelease
  const gap = preview?.policy.tierGapHours ?? PROGRAM.cascadeHoursBefore
  const low = Math.min(...totals)
  const high = Math.max(...totals)
  const lowRate = Math.min(...quotes.map((q) => q.card.billRate))
  const picked = pickedOffer(data, buyerId, loc.cityId, input.positionId)
  const lead = quotes[0]
  const why = input.firstAgencyId ? "Picked for this order" : picked === lead.supplier.id ? "Your pick" : lead.card.billRate === lowRate ? "Lowest rate" : undefined
  return {
    from: "agent",
    text: preview?.needsApproval ? "Here's the draft. It goes for approval before any agency sees it." : "Here's the draft. Nothing is booked until you click Create and send.",
    draft: {
      headcount: input.headcount,
      position: pos.name,
      location: loc.name,
      when: formatDay(input.dates[0], "EEE, MMM d"),
      time: `${formatClockShort(input.start)}–${formatClockShort(input.end)}`,
      hours,
      breakMins: input.breakMins,
      release: quotes.map(({ supplier: item, card }, index) => ({
        supplierId: item.id,
        name: item.shortName,
        rate: card.billRate,
        at: index ? `+${index * gap}h` : held ? "First" : "Now",
        ...(index === 0 && why ? { why } : {}),
      })),
      total: `${money(low)}${low === high ? "" : `–${money(high)}`}`,
      chargedTo: department ? { name: department.name, costCenter: department.costCenter } : { name: loc.name, costCenter: loc.costCenter },
      ...(held ? { note: `${preview.policy.sector} holds orders until ${preview.policy.releaseLeadHours} hours before the shift, so ${lead.supplier.shortName} sees it ${formatTimestamp(preview.firstRelease!.toISOString())}.` } : {}),
    },
    actions: [{ label: preview?.needsApproval ? "Send for approval" : "Create and send", kind: "create-shift", input, key: crypto.randomUUID() }],
  }
}

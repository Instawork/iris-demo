"use client"

import { useCallback } from "react"

import { NO_MESSAGES, useAgentThreads, type AgentAction } from "@/components/agent/agent-store"
import { useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import { parseAgentShift, type ParsedAgentShift } from "@/lib/agent-shift"
import { UPLOAD_SPECS, downloadCsv, planImport, specsFor, templateCsv, templateName } from "@/lib/csv"
import { formatClock, formatDateFull, paidHours } from "@/lib/dates"
import { money, round2 } from "@/lib/format"
import { PROGRAM, location, locationsFor, position, supplier } from "@/lib/reference"
import { detectUploadType, isSpreadsheetFile, spreadsheetToCsv } from "@/lib/spreadsheet"
import { notifiedSuppliers, useStore, type BookingInput } from "@/lib/store"
import type { UploadType } from "@/lib/types"

export const AGENT_FILE_ACCEPT =
  ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"

/** CrUber's agent: turns a sentence or a spreadsheet into a reviewed draft. Nothing is saved until the user approves it. */
export function useAgent() {
  const { ws } = useWorkspace()
  const messages = useAgentThreads((state) => state.threads[ws.id] ?? NO_MESSAGES)
  const push = useAgentThreads((state) => state.push)
  const clearThread = useAgentThreads((state) => state.clear)
  const dropActions = useAgentThreads((state) => state.dropActions)
  const setOpen = useUi((state) => state.setAgentOpen)
  const openUpload = useUi((state) => state.openUpload)
  const stageUpload = useUi((state) => state.stageUpload)

  const add = useCallback((message: Parameters<typeof push>[1]) => push(ws.id, message), [push, ws.id])

  const proposeShift = useCallback(
    (request: ParsedAgentShift) => {
      const buyerId = ws.buyerId!
      const data = useStore.getState().data
      const loc = location(request.locationId)
      const pos = position(request.positionId)
      const hours = paidHours(request.start, request.end, request.breakMins)
      const quotes = notifiedSuppliers(data, buyerId, loc.cityId, request.positionId)
      if (!quotes.length) {
        add({ from: "agent", text: `None of your approved suppliers currently staff ${pos.name} in ${loc.name}. Approve a matching supplier before posting this shift.` })
        return
      }
      const totals = quotes.map(({ card }) => round2(card.billRate * hours * request.headcount))
      const input: BookingInput = {
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
      }
      add({
        from: "agent",
        text: [
          "Draft ready — review before posting",
          `${request.headcount} ${pos.name} · ${formatDateFull(request.date)} · ${formatClock(request.start)}–${formatClock(request.end)}`,
          `${loc.name} · ${hours} paid hours${request.breakMins ? ` · ${request.breakMins}-minute unpaid break` : ""}`,
          `Release order: ${quotes.map(({ supplier: item }, index) => `${index + 1}. ${item.shortName}${index ? ` (+${index * PROGRAM.cascadeHoursBefore}h)` : " (now)"}`).join(" · ")}`,
          `Bill rates: ${quotes.map(({ supplier: item, card }) => `${item.shortName} ${money(card.billRate)}/hr`).join(" · ")}`,
          `Estimated total: ${money(Math.min(...totals))}${Math.min(...totals) === Math.max(...totals) ? "" : `–${money(Math.max(...totals))}`}`,
          "Nothing will be created until you approve below.",
        ].join("\n"),
        actions: [{ label: "Create and send", kind: "create-shift", input }],
      })
    },
    [add, ws.buyerId],
  )

  const respond = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text) return
      add({ from: "user", text })
      const lower = text.toLowerCase()

      if (ws.kind === "buyer" && /(create|book|post).*(shift)|shift.*(create|book|post)/.test(lower)) {
        const buyerId = ws.buyerId!
        const parsed = parseAgentShift(text, buyerId)
        if (!parsed.draft) {
          add({
            from: "agent",
            text: `I still need the ${parsed.missing.join(", ")}. Include them in one sentence, for example: “Create 3 line cook shifts on May 20th from 8am to 4pm.” I’ll use ${locationsFor(buyerId)[0].name} unless you name another location.`,
          })
          return
        }
        proposeShift(parsed.draft)
        return
      }

      if (lower.includes("template")) {
        const type: UploadType =
          lower.includes("rate") ? "rates" : lower.includes("professional") ? "professionals" : lower.includes("hour") ? "timesheets" : lower.includes("tip") ? "tips" : ws.kind === "compass" ? "activity" : "shifts"
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
        add({ from: "agent", text: "Flagged invoices are priced above comparable supplier rates for the same hours. Open the review queue to inspect line items, peer rates and the amount at risk.", actions: [{ label: "Review flagged invoices", kind: "link", href: "/invoices?filter=flagged" }] })
        return
      }

      if (lower.includes("safety") || lower.includes("document") || lower.includes("background")) {
        add({ from: "agent", text: "Safety exceptions include pending background checks, I-9s, orientation, and missing or expired role documents. Pros stay off shifts until their requirements are current.", actions: [{ label: "Review Pro compliance", kind: "link", href: "/professionals?filter=not_compliant" }] })
        return
      }

      if (lower.includes("hour") || lower.includes("timesheet")) {
        add({ from: "agent", text: "You can review submitted hours shift by shift, or attach a timesheet CSV for validation.", actions: [{ label: "Open hours queue", kind: "link", href: "/shifts?filter=hours" }, { label: "Upload timesheets", kind: "upload", type: "timesheets" }] })
        return
      }

      if (lower.includes("assign") || lower.includes("staff")) {
        add({ from: "agent", text: "Open Shifts to see every spot still waiting on a Pro. Each shift shows which of your Pros are cleared for the role.", actions: [{ label: "Open Shifts", kind: "link", href: "/shifts" }] })
        return
      }

      add({ from: "agent", text: "I can create a shift from one sentence, give you the right CSV template, or check an attachment before anything is saved. Try one of the suggestions, or describe what you need." })
    },
    [add, proposeShift, ws.buyerId, ws.kind],
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
        text: `I identified this as a ${UPLOAD_SPECS[type].label.toLowerCase()} upload. ${plan.okCount} row${plan.okCount === 1 ? "" : "s"} ready, ${plan.errorCount} requiring review${plan.missingColumns.length ? `, and ${plan.missingColumns.length} required column${plan.missingColumns.length === 1 ? "" : "s"} missing` : ""}. Nothing has been saved.`,
        actions: [
          { label: "Continue to upload review", kind: "review", type, fileName: file.name, csv },
          { label: "Download matching template", kind: "template", type },
        ],
      })
    },
    [add, ws],
  )

  const runAction = useCallback(
    (action: AgentAction, messageId?: number) => {
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
      if (action.kind === "create-shift") {
        const ids = useStore.getState().bookShifts(action.input)
        if (!ids.length) {
          add({ from: "agent", text: "This shift could not be created because no approved supplier has an active rate for it. Review supplier approvals and rates, then try again." })
          return
        }
        if (messageId) dropActions(ws.id, messageId)
        const pos = position(action.input.positionId)
        const created = useStore.getState().data.groups.find((group) => group.id === ids[0])
        add({
          from: "agent",
          text: `Created ${action.input.headcount} ${pos.name} spot${action.input.headcount === 1 ? "" : "s"}. ${created ? supplier(created.supplierId).shortName : "The first supplier"} received the shift first; later suppliers release every ${PROGRAM.cascadeHoursBefore} hours only while spots remain.`,
          actions: [{ label: "View created shift", kind: "link", href: `/shifts/${ids[0]}` }],
        })
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

  return { messages, respond, attach, runAction, draftShift, clear }
}

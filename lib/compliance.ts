import { daysFromToday, parseDate } from "@/lib/dates"
import { REQUIREMENTS, requirementsFor } from "@/lib/reference"
import type { ComplianceItem, ComplianceState, Pro, RequirementId } from "@/lib/types"
import { differenceInCalendarDays } from "date-fns"

export const EXPIRING_WINDOW_DAYS = 30

export function itemState(item: ComplianceItem | undefined, onDate?: string): Exclude<ComplianceState, "not_required"> {
  if (!item || item.status === "missing") return "missing"
  if (item.status === "pending") return "pending"
  if (item.expiresOn) {
    const left = onDate
      ? differenceInCalendarDays(parseDate(item.expiresOn), parseDate(onDate))
      : daysFromToday(item.expiresOn)
    if (left < 0) return "expired"
    if (left <= EXPIRING_WINDOW_DAYS) return "expiring"
  }
  return "complete"
}

export interface RequirementRow {
  id: RequirementId
  label: string
  state: ComplianceState
  item?: ComplianceItem
}

export function requirementRows(pro: Pro, onDate?: string): RequirementRow[] {
  const required = new Set(requirementsFor(pro.positionIds))
  return REQUIREMENTS.map((r) => ({
    id: r.id,
    label: r.label,
    item: pro.compliance[r.id],
    state: required.has(r.id) ? itemState(pro.compliance[r.id], onDate) : "not_required",
  }))
}

const BLOCKING: ComplianceState[] = ["missing", "pending", "expired"]

export interface ProReadiness {
  ready: boolean
  blockers: RequirementRow[]
  expiring: RequirementRow[]
  done: number
  required: number
}

export function readiness(pro: Pro, onDate?: string): ProReadiness {
  const rows = requirementRows(pro, onDate).filter((r) => r.state !== "not_required")
  const blockers = rows.filter((r) => BLOCKING.includes(r.state))
  const expiring = rows.filter((r) => r.state === "expiring")
  return {
    ready: pro.status === "active" && blockers.length === 0,
    blockers,
    expiring,
    done: rows.length - blockers.length,
    required: rows.length,
  }
}

/** The placement gate: same check whether a buyer, supplier or upload assigns the Pro. */
export function canWork(pro: Pro, positionId: string, date: string): { ok: boolean; reason?: string } {
  if (pro.status !== "active") return { ok: false, reason: "Still onboarding" }
  if (!pro.positionIds.includes(positionId)) return { ok: false, reason: "Not approved for this position" }
  const required = requirementsFor([positionId])
  for (const id of required) {
    const state = itemState(pro.compliance[id], date)
    if (BLOCKING.includes(state)) {
      const label = REQUIREMENTS.find((r) => r.id === id)?.label ?? id
      return { ok: false, reason: state === "expired" ? `${label} expired` : `${label} ${state}` }
    }
  }
  return { ok: true }
}

export type ProComplianceSummary = "ready" | "expiring" | "action_needed" | "onboarding"

export function summaryOf(pro: Pro): ProComplianceSummary {
  if (pro.status === "onboarding") return "onboarding"
  const r = readiness(pro)
  if (!r.ready) return "action_needed"
  if (r.expiring.length > 0) return "expiring"
  return "ready"
}

export const SUMMARY_LABEL: Record<ProComplianceSummary, string> = {
  ready: "Ready to work",
  expiring: "Expiring soon",
  action_needed: "Action needed",
  onboarding: "Onboarding",
}

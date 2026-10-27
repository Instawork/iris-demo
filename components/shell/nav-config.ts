import { BadgeCheck, BadgeDollarSign, Building2, Calendar, ChartColumn, Clock, FileText, LayoutGrid, MapPinned, Settings, Users, type LucideIcon } from "lucide-react"

import { summaryOf } from "@/lib/compliance"
import { daysFromToday } from "@/lib/dates"
import { awaitingApproval, filledCount, groupPhase, isOpenTo, isOutstanding, needsReview } from "@/lib/metrics"
import { withAgency } from "@/lib/timesheets"
import type { DemoData, PersonaKind, Workspace } from "@/lib/types"

export interface NavItem {
  id: string
  label: string
  href: string
  icon?: LucideIcon
  tooltip: string
  badge?: (data: DemoData, ws: Workspace) => number
  children?: NavItem[]
  kinds?: PersonaKind[]
}

export const SETTINGS_PAGES: NavItem[] = [
  { id: "settings.company", label: "Company profile", href: "/settings/company", icon: Settings, tooltip: "Your organization's details" },
  { id: "settings.locations", label: "Work locations", href: "/settings/locations", icon: Settings, tooltip: "Venues, addresses and cost centers", kinds: ["buyer"] },
  { id: "settings.positions", label: "Positions", href: "/settings/positions", icon: Settings, tooltip: "Roles, duties, attire and required certifications" },
  { id: "settings.team", label: "Team Members", href: "/settings/team", icon: Settings, tooltip: "Who can post, approve and pay" },
  { id: "settings.integrations", label: "Integrations", href: "/settings/integrations", icon: Settings, tooltip: "How you connect to Iris", kinds: ["supplier"] },
]

const shiftsBadge = (data: DemoData, ws: Workspace) => {
  if (ws.kind !== "supplier" || !ws.supplierId) return 0
  return data.groups.filter((g) => isOpenTo(g, ws.supplierId!) && groupPhase(g) === "upcoming" && daysFromToday(g.date) <= 7 && filledCount(g) < g.slots.length).length
}

const timesheetsBadge = (data: DemoData, ws: Workspace) => {
  if (ws.kind === "buyer") return data.timesheets.filter((t) => t.buyerId === ws.buyerId && t.status === "pending_approval").length
  if (ws.kind === "supplier") return data.timesheets.filter((t) => t.supplierId === ws.supplierId && withAgency(t)).length
  return 0
}

/** The same pages for everyone. Each page shows that persona's data and actions. */
export function navFor(ws: Workspace): NavItem[] {
  const kind = ws.kind
  const approvals: NavItem[] = ws.approves?.length
    ? [
        {
          id: "approvals",
          label: "Approvals",
          href: "/approvals",
          icon: BadgeCheck,
          tooltip: "Over-budget orders waiting on you",
          badge: (data, w) => data.groups.filter((g) => awaitingApproval(g) && w.approves?.includes(g.locationId)).length,
        },
      ]
    : []
  return [
    {
      id: "home",
      label: "Dashboard",
      href: "/",
      icon: LayoutGrid,
      tooltip: kind === "compass" ? "What needs you across the program, and what Iris expects next" : "What needs you today, and what Iris expects next",
    },
    ...approvals,
    ...(kind === "compass"
      ? ([
          { id: "units", label: "Units", href: "/units", icon: MapPinned, tooltip: "Every unit that buys labor, what it orders and requires. Add new ones." },
          { id: "agencies", label: "Agencies", href: "/agencies", icon: Building2, tooltip: "Every agency on the program: rates, Pros, paperwork and performance. Add new ones." },
        ] satisfies NavItem[])
      : []),
    {
      id: "shifts",
      label: "Shifts",
      href: "/shifts",
      icon: Calendar,
      tooltip: kind === "supplier" ? "Shifts open to you. Assign Pros." : kind === "buyer" ? "Post shifts and track who's coming" : "Every shift across every buyer and supplier",
      badge: kind === "supplier" ? shiftsBadge : undefined,
    },
    {
      id: "timesheets",
      label: "Timesheets",
      href: "/timesheets",
      icon: Clock,
      tooltip:
        kind === "supplier"
          ? "Hours from your finished shifts. Check and submit them."
          : kind === "buyer"
            ? "Hours checked against the clock. Approve them."
            : "Every timesheet, with the clock beside what was billed",
      badge: kind === "compass" ? undefined : timesheetsBadge,
    },
    {
      id: "rates",
      label: "Supplier Rates",
      href: "/rates",
      icon: BadgeDollarSign,
      tooltip:
        kind === "supplier"
          ? "Your pay rate, markup and bill rate by city"
          : kind === "buyer"
            ? "Bill rates in your cities. Open a supplier to approve it for your shifts."
            : "Every supplier's rates side by side, and every change to them",
    },
    {
      id: "professionals",
      label: "Professionals",
      href: "/professionals",
      icon: Users,
      tooltip: kind === "supplier" ? "Your Pros, their onboarding and compliance" : kind === "buyer" ? "Pros who work your shifts. Rate and review them." : "Every Pro and their compliance",
      badge:
        kind === "supplier"
          ? (data, w) => data.pros.filter((p) => p.supplierId === w.supplierId && ["onboarding", "action_needed"].includes(summaryOf(p))).length
          : undefined,
    },
    {
      id: "invoices",
      label: "Invoices",
      href: "/invoices",
      icon: FileText,
      tooltip: kind === "compass" ? "Every invoice, with anomalies flagged" : kind === "buyer" ? "Invoices for your locations" : "What you are owed",
      badge:
        kind === "compass"
          ? (data) => data.invoices.filter((i) => needsReview(data, i)).length
          : kind === "buyer"
            ? (data, w) => data.invoices.filter((i) => i.buyerId === w.buyerId && isOutstanding(i)).length
            : undefined,
    },
    {
      id: "reports",
      label: "Reports",
      href: "/reports",
      icon: ChartColumn,
      tooltip:
        kind === "compass"
          ? "Spend, fill and reliability across the program, your way"
          : kind === "buyer"
            ? "Spend, hours and agency performance at your locations"
            : "What you billed and how you filled, by buyer and week",
    },
  ]
}

export const settingsFor = (ws: Workspace) => SETTINGS_PAGES.filter((p) => !p.kinds || p.kinds.includes(ws.kind))

export const SECTION_LABELS: Record<string, string> = {
  "": "Dashboard",
  approvals: "Approvals",
  onboarding: "Onboarding",
  units: "Units",
  agencies: "Agencies",
  shifts: "Shifts",
  timesheets: "Timesheets",
  professionals: "Professionals",
  rates: "Supplier Rates",
  invoices: "Invoices",
  reports: "Reports",
  uploads: "Uploads",
  settings: "Settings",
}

export const SETTINGS_LABELS: Record<string, string> = {
  company: "Company profile",
  locations: "Work locations",
  positions: "Positions",
  team: "Team Members",
  integrations: "Integrations",
}

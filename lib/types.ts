export type PersonaKind = "compass" | "buyer" | "supplier"

export interface WorkspaceUser {
  name: string
  firstName: string
  title: string
  email: string
}

export interface Workspace {
  id: string
  kind: PersonaKind
  name: string
  sublabel: string
  buyerId?: string
  supplierId?: string
  user: WorkspaceUser
  /** Locations whose over-budget orders this person approves. */
  approves?: string[]
}

/** How a sector runs ordering and release. Set by the sector, enforced on every order. */
export interface SectorPolicy {
  buyerId: string
  sector: string
  ordering: "event" | "shift"
  /** Most spots one order can create. */
  maxSpotsPerOrder: number
  /** Orders are held until this many hours before the shift starts. 0 releases right away. */
  releaseLeadHours: number
  /** Hours between one agency's release and the next. */
  tierGapHours: number
  /** Over budget by more than this share needs an approver. 0 means any overage. */
  approvalOverPct: number
  /** Sector training every worker needs, shown on orders. */
  requiredTraining?: string
}

export interface UnitBudget {
  locationId: string
  /** Monday the week starts. */
  weekStart: string
  amount: number
}

export interface ApprovalRequest {
  status: "pending" | "approved" | "declined"
  requestedAt: string
  requestedBy: string
  requestedByWorkspace: string
  weekStart: string
  budget: number
  /** Agency spend already committed that week before this order. */
  committed: number
  estimate: number
  overPct: number
  decidedAt?: string
  decidedBy?: string
  note?: string
}

export interface Scope {
  kind: PersonaKind
  buyerId?: string
  supplierId?: string
}

export interface City {
  id: string
  name: string
  state: string
  tz: string
  zips: string[]
  payIndex: number
}

export interface Buyer {
  id: string
  brand: string
  region: string
  name: string
  sector: string
}

export interface Location {
  id: string
  buyerId: string
  name: string
  kind: string
  cityId: string
  address: string
  zip: string
  costCenter: string
}

export type PositionCategory = "Front of house" | "Back of house" | "Events"

export interface Position {
  id: string
  name: string
  category: PositionCategory
  basePay: number
  foodHandler: boolean
  alcohol: boolean
  duties: string
  attire: string
}

export type Integration = "api" | "csv"

export interface SupplierProfile {
  fillRate: number
  hoursToFill: number
  noShowRate: number
  compliance: number
  payIndex: number
  markupPct: number
  share: number
}

export interface Supplier {
  id: string
  name: string
  shortName: string
  initials: string
  color: string
  integration: Integration
  integrationDetail: string
  /** Upload types this supplier never sends as CSV because its integration syncs them. */
  syncedUploads: UploadType[]
  isInstawork: boolean
  tagline: string
  cityIds: string[]
  coiExpiresInDays: number
  contactName: string
  contactEmail: string
  profile: SupplierProfile
}

export type RequirementId = "background" | "i9" | "orientation" | "foodHandler" | "alcohol"

export interface ComplianceItem {
  status: "complete" | "pending" | "missing"
  completedOn?: string
  expiresOn?: string
}

export type ComplianceState = "complete" | "pending" | "missing" | "expiring" | "expired" | "not_required"

export type ProLevel = "platinum" | "gold" | "silver" | "bronze"

export interface Pro {
  id: string
  code: string
  supplierId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  cityId: string
  positionIds: string[]
  rating: number
  shiftsWorked: number
  reliability: number
  joinedOn: string
  status: "active" | "onboarding"
  level: ProLevel | null
  compliance: Partial<Record<RequirementId, ComplianceItem>>
}

export interface RateCard {
  id: string
  supplierId: string
  cityId: string
  positionId: string
  proRate: number
  billRate: number
  markupPct: number
  zips: string[]
  zipsAutoFilled: boolean
  status: "active" | "pending_review" | "changes_requested"
  effectiveFrom: string
  updatedAt: string
  source: "manual" | "upload" | "api"
  uploadId?: string
}

export type SlotStatus = "open" | "confirmed" | "completed" | "no_show"

export interface Slot {
  id: string
  proId?: string
  status: SlotStatus
  confirmedAt?: string
}

export interface ShiftGroup {
  id: string
  code: string
  buyerId: string
  locationId: string
  positionId: string
  name?: string
  eventName?: string
  date: string
  start: string
  end: string
  breakMins: number
  /** The supplier whose rates price the estimate; also counted for its fill metrics. */
  supplierId: string
  /** Suppliers the shift was sent to: the buyer's approved suppliers when it was posted. */
  supplierIds: string[]
  /** Ordered supplier release plan. supplierIds contains the entries already released. */
  supplierReleases?: { supplierId: string; releasedAt: string }[]
  billRate: number
  proRate: number
  markupPct: number
  slots: Slot[]
  badges: string[]
  instructions: string
  attire: string
  createdAt: string
  createdBy: string
  source: "booking" | "upload"
  uploadId?: string
  cancelledAt?: string
  liveFill?: { startedAt: string }
  /** Set when the order went over the unit's budget and needed an approver. */
  approval?: ApprovalRequest
}

export type TimesheetStatus = "awaiting_submission" | "submitted" | "approved" | "disputed"

export interface TimesheetDispute {
  reason: string
  note?: string
  raisedAt: string
  raisedBy: string
  response?: string
  respondedAt?: string
}

export interface Timesheet {
  id: string
  groupId: string
  slotId: string
  proId: string
  supplierId: string
  buyerId: string
  locationId: string
  positionId: string
  date: string
  scheduledStart: string
  scheduledEnd: string
  clockIn?: string
  clockOut?: string
  breakMins: number
  hours: number
  billRate: number
  tips: number
  status: TimesheetStatus
  source: "app" | "csv" | "manual"
  submittedAt?: string
  approvedAt?: string
  approvedBy?: string
  dispute?: TimesheetDispute
  adjustment?: { reason: string; previousHours: number; at: string; by: string }
  invoiceId?: string
}

export type InvoiceStatus = "unpaid" | "paid" | "partial" | "in_process"

export interface InvoiceLine {
  id: string
  timesheetId?: string
  proId?: string
  proName: string
  groupId?: string
  positionId: string
  locationId: string
  date: string
  scheduledStart?: string
  scheduledEnd?: string
  clockIn?: string
  clockOut?: string
  hours: number
  billRate: number
  amount: number
  tips: number
}

export interface InvoiceReview {
  status: "reviewed" | "sent_back"
  by: string
  at: string
  note?: string
}

export interface Invoice {
  id: string
  number: string
  supplierId: string
  buyerId: string
  periodStart: string
  periodEnd: string
  issuedOn: string
  dueOn: string
  status: InvoiceStatus
  paidAmount: number
  lines: InvoiceLine[]
  groupId?: string
  source: "auto" | "upload"
  uploadId?: string
  review?: InvoiceReview
}

export interface InvoiceGroup {
  id: string
  code: string
  name: string
  buyerId?: string
  createdOn: string
  createdBy: string
  invoiceIds: string[]
}

export type UploadType = "shifts" | "timesheets" | "tips" | "rates" | "professionals" | "activity"

export type UploadStatus = "completed" | "completed_with_errors" | "failed" | "needs_review"

export interface UploadIssue {
  row: number
  column?: string
  message: string
  level: "error" | "warning"
  /** The agent's proposed fix: a corrected cell value, or dropping the row. */
  suggestion?: { value?: string; removeRow?: boolean; label: string }
}

export interface Upload {
  id: string
  code: string
  type: UploadType
  fileName: string
  uploadedBy: string
  actorKind: PersonaKind
  buyerId?: string
  supplierId?: string
  uploadedAt: string
  status: UploadStatus
  totalRows: number
  successRows: number
  errorRows: number
  issues: UploadIssue[]
  summary: string
  csv?: string
}

export interface BusinessActivity {
  id: string
  locationId: string
  date: string
  events: number
  mealsServed: number
  revenue: number
  uploadId: string
}

export interface ProReview {
  id: string
  proId: string
  buyerId: string
  groupId?: string
  rating: number
  text: string
  by: string
  at: string
}

export type RosterStatus = "favorite" | "ok_to_return" | "blocked"

export interface RosterEntry {
  id: string
  buyerId: string
  proId: string
  status: RosterStatus
  addedOn: string
}

export interface ActivityEvent {
  id: string
  at: string
  text: string
  actor: string
  tone: "neutral" | "positive" | "warning" | "critical" | "primary"
  buyerId?: string
  supplierId?: string
  groupId?: string
  invoiceId?: string
}

export interface Counters {
  sg: number
  inv: number
  ig: number
  upl: number
  pro: number
  rate: number
  ts: number
  ev: number
  rev: number
  act: number
}

export interface DemoData {
  version: number
  seededOn: string
  pros: Pro[]
  rateCards: RateCard[]
  groups: ShiftGroup[]
  timesheets: Timesheet[]
  invoices: Invoice[]
  invoiceGroups: InvoiceGroup[]
  uploads: Upload[]
  roster: RosterEntry[]
  activity: ActivityEvent[]
  /** Buyer id to the supplier ids it approved. Only approved suppliers are sent its new shifts. */
  approvals: Record<string, string[]>
  reviews: ProReview[]
  businessActivity: BusinessActivity[]
  budgets: UnitBudget[]
  /** Presenter controls for the demo tenant. */
  settings?: { pausedAgencies?: string[] }
  counters: Counters
}

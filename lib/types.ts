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
  /** Compass's super sector, like Sports & Leisure. The brand is the sector inside it. */
  sector: string
}

/** Who added a unit or an agency to Iris, and when. Missing for the ones Iris shipped with. */
export interface Onboarded {
  at: string
  by: string
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
  /** Roles this unit orders. Missing means any. */
  positionIds?: string[]
  /** Documents this unit requires of every Pro, on top of the program's and each role's own. */
  requires?: RequirementId[]
  /** Pros rated below this don't get its shifts. */
  minRating?: number
  /** Workspaces that approve its over-budget orders, beside the buyer's district approvers. */
  approverIds?: string[]
  /** Parts of the unit that are charged separately, like a stadium's concessions and its suites. */
  departments?: Department[]
  onboarded?: Onboarded
}

export interface Department {
  id: string
  name: string
  costCenter: string
  /** Roles that land here unless the order says otherwise. */
  positionIds?: string[]
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

/** What an agency agrees to beyond its rates. VA is the rebate it pays Compass at year end, as a share of spend. */
export interface ContractTerms {
  /** The VA in force: the tier the agency's yearly spend with Compass reaches. */
  vaPct: number
  /** VA by yearly spend, as [spend from, percent], lowest first. The whole year's spend earns the tier it reaches. */
  vaTiers?: [number, number][]
  netDays: number
  years: number
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
  /** Missing on onboarded agencies, which start on the program's terms. */
  contract?: ContractTerms
  onboarded?: Onboarded & { coiExpiresOn: string; coiFile?: string; msaSignedOn?: string }
}

/** Units and agencies onboarded on Iris, beside the ones it shipped with. Every lookup sees both. */
export interface Directory {
  locations: Location[]
  suppliers: Supplier[]
  workspaces: Workspace[]
}

export type RequirementId = "background" | "i9" | "orientation" | "foodHandler" | "alcohol"

/** How Iris confirmed a document: the agency attests it, then Iris checks it with whoever issued it. */
export interface Verification {
  checkedWith: string
  reference: string
  at: string
  result: "verified" | "needs_review" | "rejected"
  /** Why Iris couldn't confirm it. */
  reason?: string
  attestedBy: string
  file?: string
  /** Compass compliance's call on one Iris couldn't confirm. */
  reviewedBy?: string
  reviewNote?: string
}

export interface ComplianceItem {
  status: "complete" | "pending" | "missing"
  completedOn?: string
  expiresOn?: string
  verification?: Verification
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
  rateReview?: RateReview
}

export interface RateValues {
  proRate: number
  billRate: number
  markupPct: number
  status: RateCard["status"]
}

/** One change to one rate card, kept even after the card is gone. */
export interface RateChange {
  id: string
  at: string
  by: string
  cardId: string
  supplierId: string
  cityId: string
  positionId: string
  action: "added" | "changed" | "removed"
  /** Where it came from: typed in, a CSV upload, the agency's system, onboarding, an answer to Compass's review, or an approved bid. */
  source: "manual" | "upload" | "api" | "onboarding" | "review" | "award"
  from?: RateValues
  to?: RateValues
  uploadId?: string
  note?: string
}

/** One thing being priced in a sourcing event: a role in the event's market, with the hours Compass expects to buy. */
export interface SourcingLine {
  id: string
  positionId: string
  /** Estimated hours a year. */
  hours: number
  /** Each invited agency's bill rate when the event opened, the baseline its bid is measured against. */
  baseline: Record<string, number>
  /** Each invited agency's share of the hours today. */
  share: Record<string, number>
}

export interface BidLine {
  proRate: number
  markupPct: number
  billRate: number
}

/** One round of an agency's prices. The latest round is its bid. */
export interface Bid {
  supplierId: string
  round: number
  at: string
  by: string
  lines: Record<string, BidLine>
  note?: string
  /** The terms the agency offers with these prices. Missing means the ones it has now. */
  terms?: ContractTerms
}

export interface SourcingMessage {
  id: string
  at: string
  by: string
  supplierId: string
  from: "compass" | "agency"
  text: string
  lineId?: string
  /** A counter: the bill rate Compass asked for. */
  ask?: number
  /** A counter stays open until the agency answers it. */
  open?: boolean
}

/** A sourcing event: invited agencies bid on a set of lines, Compass negotiates, and approved bids become rate cards. */
export interface SourcingEvent {
  id: string
  number: string
  title: string
  category: string
  cityId: string
  status: "open" | "awarded"
  createdBy: string
  openedAt: string
  /** Bids are due by this date. */
  closesOn: string
  termStart: string
  termEnd: string
  lines: SourcingLine[]
  invited: string[]
  bids: Bid[]
  messages: SourcingMessage[]
  /** Agency id to when Compass approved its bid. */
  approved: Record<string, string>
  awardedAt?: string
}

/** Compass asking an agency to review a rate that runs above what the other agencies charge for the same city and role. */
export interface RateReview {
  status: "requested" | "lowered" | "kept"
  requestedAt: string
  requestedBy: string
  /** The rating-weighted rate the other agencies charge, scaled to this agency's score. */
  marketRate: number
  /** The bill rate when Compass asked. */
  fromRate: number
  invoiceId?: string
  note?: string
  answeredAt?: string
  answeredBy?: string
  answer?: string
}

export type SlotStatus = "open" | "confirmed" | "completed" | "no_show"

export interface Slot {
  id: string
  proId?: string
  status: SlotStatus
  confirmedAt?: string
  /** Punches the worker recorded on Iris check-in while the shift was on. */
  punches?: Punches
  /** The buyer sent the worker home early, so the four-hour minimum applies. */
  sentHome?: boolean
  /** Roles the worker moved to partway through the shift, in order. */
  moves?: RoleMove[]
}

/** A worker moved to another role during a shift, billed at that role's rate from then on. */
export interface RoleMove {
  /** Wall-clock time the new role started. */
  at: string
  fromPositionId: string
  positionId: string
  fromDepartmentId?: string
  departmentId?: string
  billRate: number
  by: string
  recordedAt: string
  note?: string
}

/** One side of a timesheet split where the worker changed roles. */
export interface RoleLink {
  timesheetId: string
  positionId: string
  departmentId?: string
  at: string
}

export interface Punches {
  in?: string
  breakStart?: string
  breakEnd?: string
  out?: string
}

export interface ShiftGroup {
  id: string
  code: string
  buyerId: string
  locationId: string
  positionId: string
  /** The department it's charged to. Missing means the one its role belongs to. */
  departmentId?: string
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
  /** Who the buyer sent it to when not everyone in the release order: one agency, and named Pros booked first. */
  dispatch?: { supplierId?: string; proIds?: string[] }
}

/** Fieldglass's time sheet statuses, which Compass's approvers already know. */
export type TimesheetStatus = "draft" | "pending_approval" | "approved" | "rejected" | "invoiced" | "removed"

/** Times Iris recorded itself, independent of what the agency bills. */
export interface ClockRecord {
  in?: string
  out?: string
  breakMins: number
  source: "instawork_app" | "iris_checkin"
}

export interface BilledTimes {
  clockIn?: string
  clockOut?: string
  breakMins: number
  hours: number
}

export type TimesheetAction = "created" | "submitted" | "withdrawn" | "edited" | "corrected" | "moved" | "approved" | "rejected" | "removed" | "invoiced" | "credited"

export interface TimesheetChange {
  at: string
  by: string
  action: TimesheetAction
  from?: BilledTimes
  to?: BilledTimes
  reason?: string
  note?: string
}

export interface TimesheetRejection {
  reason: string
  note?: string
  at: string
  by: string
}

export type ExpenseKind = "parking" | "background_check" | "other"

/** A cost the agency paid for this shift, billed at cost: parking, or a background check the event required. */
export interface Expense {
  id: string
  kind: ExpenseKind
  amount: number
  note?: string
  at: string
  by: string
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
  /** Set when this part of the shift was worked in another department than the order's. */
  departmentId?: string
  date: string
  scheduledStart: string
  scheduledEnd: string
  scheduledBreakMins: number
  /** Billed times: what the agency submits, and what approval and invoicing use. */
  clockIn?: string
  clockOut?: string
  breakMins: number
  hours: number
  /** The part of `hours` past 40 in the work week with this agency, billed at the overtime rate. */
  otHours: number
  clock?: ClockRecord
  /** Billed at the four-hour minimum because the buyer sent the worker home early. */
  sentHome?: boolean
  billRate: number
  tips: number
  /** Approved with the hours, so the agency adds them before it submits. */
  expenses?: Expense[]
  status: TimesheetStatus
  source: "app" | "csv" | "manual"
  submittedAt?: string
  approvedAt?: string
  approvedBy?: string
  rejection?: TimesheetRejection
  history: TimesheetChange[]
  invoiceId?: string
  /** The role worked before this part of the shift, when the worker moved partway through. */
  movedFrom?: RoleLink
  /** The role the worker moved to after this part. */
  movedTo?: RoleLink
}

/** "open" is this week's invoice: Iris adds approved hours to it until the week closes, then issues it. */
export type InvoiceStatus = "open" | "unpaid" | "paid" | "partial" | "in_process"

export interface InvoiceLine {
  id: string
  timesheetId?: string
  proId?: string
  proName: string
  groupId?: string
  positionId: string
  locationId: string
  departmentId?: string
  date: string
  scheduledStart?: string
  scheduledEnd?: string
  clockIn?: string
  clockOut?: string
  hours: number
  otHours?: number
  billRate: number
  amount: number
  tips: number
  expenses?: Expense[]
}

/** Compass's decision on an invoice priced above the market. Either way it's cleared for payment; a rate review also asks the agency to look at its rates. */
export interface InvoiceReview {
  status: "reviewed" | "rate_review"
  by: string
  at: string
  note?: string
}

/** Compass's decision on lines Iris found billed above its own records, and the agency's credit when it sends them back. */
export interface InvoiceBillingReview {
  status: "sent_back" | "credited" | "accepted"
  lineIds: string[]
  amount: number
  at: string
  by: string
  note?: string
  creditedAt?: string
  creditedBy?: string
}

/** Takes billed hours off an invoice line, the way a revised time sheet does in Fieldglass. */
export interface InvoiceCredit {
  id: string
  lineId: string
  timesheetId?: string
  proName: string
  date: string
  hours: number
  amount: number
  reason: string
  at: string
  by: string
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
  billingReview?: InvoiceBillingReview
  credits?: InvoiceCredit[]
}

export interface InvoiceGroup {
  id: string
  code: string
  name: string
  buyerId?: string
  /** Set on the consolidated invoice Iris keeps for each month across all of Compass, as "YYYY-MM". Groups made by hand have none. */
  month?: string
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

export type ReportMeasure = "spend" | "hours" | "workers" | "costPerHour" | "aboveClock" | "shifts" | "spots" | "fillRate" | "noShowRate" | "timeToFill"

export type ReportDimension = "week" | "month" | "buyer" | "location" | "market" | "agency" | "position"

export type ReportPeriod = "last_7" | "last_28" | "last_90" | "this_month" | "last_month" | "custom"

export type ReportFilterKey = "buyer" | "location" | "market" | "agency" | "position"

/** What a report shows. Saved reports, links and the chat all carry one. */
export interface ReportSpec {
  measures: ReportMeasure[]
  groupBy: ReportDimension
  splitBy?: ReportDimension
  period: ReportPeriod
  /** Only for a custom period. */
  from?: string
  to?: string
  /** Empty or missing means all. */
  filters: Partial<Record<ReportFilterKey, string[]>>
}

export interface ReportSchedule {
  cadence: "daily" | "weekly" | "monthly"
  /** HH:MM in the program's time zone. Weekly goes out on Mondays, monthly on the 1st. */
  time: string
  recipients: string[]
  lastSentAt?: string
}

/** The three report pages every side gets: how agencies perform, where the money goes, and who it goes to each week. */
export type ReportView = "scorecard" | "locations" | "spend"

export interface SavedReport {
  id: string
  name: string
  description?: string
  /** Who shares it: "compass", "buyer:<id>" or "supplier:<id>". */
  org: string
  /** The report page it backs, which carries its email schedule. */
  view?: ReportView
  spec: ReportSpec
  createdBy: string
  createdAt: string
  updatedAt: string
  schedule?: ReportSchedule
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
  rep: number
  rlog: number
}

export interface DemoData {
  version: number
  seededOn: string
  /** When the demo data was generated. Drafts from before then wait for a person to submit them. */
  seededAt?: string
  pros: Pro[]
  rateCards: RateCard[]
  /** Every rate card change, newest first. */
  rateLog: RateChange[]
  /** Sourcing events, newest first. Approved bids land on the rate cards above. */
  sourcing?: SourcingEvent[]
  groups: ShiftGroup[]
  timesheets: Timesheet[]
  invoices: Invoice[]
  invoiceGroups: InvoiceGroup[]
  uploads: Upload[]
  roster: RosterEntry[]
  activity: ActivityEvent[]
  /** Buyer id to the supplier ids it approved. Only approved suppliers are sent its new shifts. */
  approvals: Record<string, string[]>
  /** Buyer id to the agency it picked per market and role (`cityId:positionId`). Without a pick, the lowest rate goes first. */
  offerPicks?: Record<string, Record<string, string>>
  reviews: ProReview[]
  businessActivity: BusinessActivity[]
  budgets: UnitBudget[]
  reports: SavedReport[]
  directory: Directory
  /** Presenter controls for the demo tenant. */
  settings?: {
    pausedAgencies?: string[]
  }
  counters: Counters
}

import type { Buyer, City, ContractTerms, Department, Directory, Location, Position, RequirementId, SectorPolicy, Supplier, Workspace } from "@/lib/types"

/** Program rules Compass sets for every supplier on Iris. */
export const PROGRAM = {
  name: "Compass Group USA",
  paymentTermsDays: 15,
  dueSoonDays: 7,
  cascadeHoursBefore: 4,
  /** Over-budget orders wait for a district approver. Off until a buyer asks for it. */
  budgetApprovals: false,
}

/** Each sector runs ordering its own way. Levy orders by event and holds release until 72 hours before doors. */
export const SECTOR_POLICIES: SectorPolicy[] = [
  {
    buyerId: "levy-chi",
    sector: "Levy",
    ordering: "event",
    maxSpotsPerOrder: 400,
    releaseLeadHours: 72,
    tierGapHours: 4,
    approvalOverPct: 0,
    requiredTraining: "Creating Legends",
  },
  {
    buyerId: "chartwells-south",
    sector: "Chartwells",
    ordering: "shift",
    maxSpotsPerOrder: 120,
    releaseLeadHours: 0,
    tierGapHours: 4,
    approvalOverPct: 0,
  },
]

export const CITIES: City[] = [
  {
    id: "chi",
    name: "Chicago",
    state: "IL",
    tz: "CT",
    payIndex: 1.12,
    zips: [
      "60601", "60602", "60603", "60604", "60605", "60606", "60607", "60608", "60610",
      "60611", "60612", "60613", "60614", "60616", "60622", "60642", "60654", "60661",
    ],
  },
  {
    id: "atl",
    name: "Atlanta",
    state: "GA",
    tz: "ET",
    payIndex: 1.0,
    zips: [
      "30303", "30305", "30306", "30307", "30308", "30309", "30310", "30312", "30313",
      "30314", "30318", "30324", "30326", "30332", "30363",
    ],
  },
  {
    id: "dal",
    name: "Dallas",
    state: "TX",
    tz: "CT",
    payIndex: 0.98,
    zips: [
      "75201", "75202", "75204", "75205", "75206", "75207", "75208", "75214", "75219",
      "75226", "75235", "75246",
    ],
  },
]

export const BUYERS: Buyer[] = [
  { id: "levy-chi", brand: "Levy", region: "Chicago", name: "Levy · Chicago", sector: "Sports & Leisure" },
  { id: "chartwells-south", brand: "Chartwells", region: "South", name: "Chartwells · South", sector: "Education" },
]

const DEPARTMENTS_BY_KIND: Record<string, { name: string; positionIds: string[] }[]> = {
  venue: [
    { name: "Concessions", positionIds: ["concessions", "cashier", "porter"] },
    { name: "Bars", positionIds: ["bartender", "barback"] },
    { name: "Suites", positionIds: ["suite"] },
  ],
  "Convention center": [
    { name: "Banquets", positionIds: ["server", "bartender", "barback", "porter"] },
    { name: "Kitchen", positionIds: ["linecook", "prepcook", "dishwasher"] },
  ],
  dining: [
    { name: "Residential dining", positionIds: ["linecook", "prepcook", "dishwasher", "server"] },
    { name: "Retail", positionIds: ["cashier", "concessions", "porter"] },
  ],
}

const VENUE_ROLES = ["bartender", "barback", "concessions", "suite", "cashier", "porter"]
const ROLES_FOR: Record<string, string[]> = {
  Stadium: VENUE_ROLES,
  Arena: VENUE_ROLES,
  Ballpark: VENUE_ROLES,
  "Convention center": ["server", "bartender", "porter", "linecook", "dishwasher"],
}

/** The roles a unit of this kind usually orders. */
export const rolesFor = (kind: string) => ROLES_FOR[kind] ?? ["linecook", "prepcook", "dishwasher", "cashier"]

/** The departments a unit of this kind usually has, each charged to its own cost center under the unit's. */
export function departmentsFor(kind: string, costCenter: string): Department[] {
  const key = ["Stadium", "Arena", "Ballpark"].includes(kind) ? "venue" : kind === "Convention center" ? kind : "dining"
  return DEPARTMENTS_BY_KIND[key].map((d, i) => ({
    id: d.name.toLowerCase().replace(/[^a-z]+/g, "-"),
    name: d.name,
    costCenter: costCenter ? `${costCenter}-${(i + 1) * 10}` : "",
    positionIds: d.positionIds,
  }))
}

const withDepartments = (l: Location): Location => ({ ...l, departments: departmentsFor(l.kind, l.costCenter) })

const SHIPPED_LOCATIONS: Location[] = [
  {
    id: "loc-lfs",
    buyerId: "levy-chi",
    name: "Lakefront Stadium",
    kind: "Stadium",
    cityId: "chi",
    address: "1200 S Lakefront Way, Chicago, IL",
    zip: "60605",
    costCenter: "LEV-4410",
  },
  {
    id: "loc-wla",
    buyerId: "levy-chi",
    name: "West Loop Arena",
    kind: "Arena",
    cityId: "chi",
    address: "1901 W Madison Ave, Chicago, IL",
    zip: "60612",
    costCenter: "LEV-4420",
  },
  {
    id: "loc-rcc",
    buyerId: "levy-chi",
    name: "Riverside Convention Center",
    kind: "Convention center",
    cityId: "chi",
    address: "2301 S Riverside Plaza, Chicago, IL",
    zip: "60616",
    costCenter: "LEV-4430",
  },
  {
    id: "loc-nsb",
    buyerId: "levy-chi",
    name: "Northside Ballpark",
    kind: "Ballpark",
    cityId: "chi",
    address: "1060 W Addison Ave, Chicago, IL",
    zip: "60613",
    costCenter: "LEV-4440",
  },
  {
    id: "loc-pu",
    buyerId: "chartwells-south",
    name: "Peachtree University Dining",
    kind: "Campus dining",
    cityId: "atl",
    address: "350 Ferst Commons Dr, Atlanta, GA",
    zip: "30332",
    costCenter: "CHW-2210",
  },
  {
    id: "loc-mtc",
    buyerId: "chartwells-south",
    name: "Midtown College Student Center",
    kind: "Campus dining",
    cityId: "atl",
    address: "75 Fifth St NW, Atlanta, GA",
    zip: "30308",
    costCenter: "CHW-2220",
  },
  {
    id: "loc-ttu",
    buyerId: "chartwells-south",
    name: "Trinity Tech Union Market",
    kind: "Campus dining",
    cityId: "dal",
    address: "3140 Dyer Commons, Dallas, TX",
    zip: "75205",
    costCenter: "CHW-2310",
  },
].map(withDepartments)

export const POSITIONS: Position[] = [
  {
    id: "bartender",
    name: "Bartender",
    category: "Front of house",
    basePay: 18,
    foodHandler: false,
    alcohol: true,
    duties: "Prepare and serve beer, wine and cocktails. Check IDs, keep the bar stocked and clean, and run a cash or card register.",
    attire: "All black: black button-up shirt, black pants, black non-slip shoes.",
  },
  {
    id: "barback",
    name: "Barback",
    category: "Front of house",
    basePay: 16,
    foodHandler: false,
    alcohol: true,
    duties: "Restock ice, glassware, kegs and garnishes. Support bartenders and keep the bar area clean and safe.",
    attire: "Black t-shirt, black pants, black non-slip shoes.",
  },
  {
    id: "server",
    name: "Banquet Server",
    category: "Front of house",
    basePay: 17.5,
    foodHandler: true,
    alcohol: true,
    duties: "Set and reset banquet rooms, serve plated and buffet meals, clear tables and follow the event captain's run of show.",
    attire: "White button-up shirt, black vest, black pants, black non-slip shoes.",
  },
  {
    id: "concessions",
    name: "Concessions Attendant",
    category: "Front of house",
    basePay: 16,
    foodHandler: true,
    alcohol: false,
    duties: "Take orders, handle cash and card payments, assemble food and keep the stand stocked during the event.",
    attire: "Venue-provided polo and hat, black pants, non-slip shoes.",
  },
  {
    id: "cashier",
    name: "Cashier",
    category: "Front of house",
    basePay: 16,
    foodHandler: false,
    alcohol: false,
    duties: "Ring up orders accurately, handle payments and keep the checkout area clean and welcoming.",
    attire: "Black shirt, black pants, closed-toe shoes.",
  },
  {
    id: "suite",
    name: "Suite Attendant",
    category: "Front of house",
    basePay: 19,
    foodHandler: true,
    alcohol: true,
    duties: "Host premium suites: set food and beverage, serve guests, track orders and keep the suite spotless.",
    attire: "Black suit vest, white shirt, black pants, polished black shoes.",
  },
  {
    id: "linecook",
    name: "Line Cook",
    category: "Back of house",
    basePay: 20,
    foodHandler: true,
    alcohol: false,
    duties: "Prepare menu items to recipe on the line, follow ticket times and keep the station clean and food safe.",
    attire: "Chef coat, black pants, non-slip shoes. Hair restraint required.",
  },
  {
    id: "prepcook",
    name: "Prep Cook",
    category: "Back of house",
    basePay: 18,
    foodHandler: true,
    alcohol: false,
    duties: "Wash, cut and portion ingredients, label and date product, and support the line during service.",
    attire: "Chef coat or black shirt, black pants, non-slip shoes. Hair restraint required.",
  },
  {
    id: "dishwasher",
    name: "Dishwasher",
    category: "Back of house",
    basePay: 16,
    foodHandler: false,
    alcohol: false,
    duties: "Run the dish machine, clean pots and pans, empty trash and keep the dish pit organized.",
    attire: "Dark shirt, dark pants, non-slip shoes.",
  },
  {
    id: "porter",
    name: "Event Porter",
    category: "Events",
    basePay: 16.5,
    foodHandler: false,
    alcohol: false,
    duties: "Move tables and equipment, restock stations, remove trash and keep public areas clean during the event.",
    attire: "Black t-shirt, black pants, closed-toe work shoes.",
  },
]

const SHIPPED_SUPPLIERS: Supplier[] = [
  {
    id: "crewline",
    name: "Crewline Staffing",
    shortName: "Crewline",
    initials: "CS",
    color: "var(--supplier-crewline)",
    integration: "api",
    integrationDetail: "API connection: shift requests and timesheets sync hourly.",
    syncedUploads: ["timesheets"],
    isInstawork: false,
    tagline: "Regional event and culinary staffing",
    cityIds: ["chi", "atl"],
    coiExpiresInDays: 126,
    contactName: "Devon Brooks",
    contactEmail: "devon@crewline.example",
    profile: { fillRate: 0.88, hoursToFill: 9, noShowRate: 0.032, compliance: 0.94, payIndex: 1.0, markupPct: 36, share: 0.24 },
    contract: { vaPct: 12, vaTiers: [[0, 8], [1_000_000, 10], [2_500_000, 12]], netDays: 30, years: 2 },
  },
  {
    id: "harbor",
    name: "Harbor Hospitality",
    shortName: "Harbor",
    initials: "HH",
    color: "var(--supplier-harbor)",
    integration: "csv",
    integrationDetail: "CSV upload: timesheets and invoices arrive as files, usually the next morning.",
    syncedUploads: [],
    isInstawork: false,
    tagline: "Premium banquet and suite staff",
    cityIds: ["chi", "dal"],
    coiExpiresInDays: 18,
    contactName: "Renee Park",
    contactEmail: "renee@harborhospitality.example",
    profile: { fillRate: 0.91, hoursToFill: 14, noShowRate: 0.024, compliance: 0.96, payIndex: 1.04, markupPct: 42, share: 0.18 },
    contract: { vaPct: 5, vaTiers: [[0, 3], [1_500_000, 5], [3_000_000, 8]], netDays: 45, years: 1 },
  },
  {
    id: "instawork",
    name: "Instawork",
    shortName: "Instawork",
    initials: "IW",
    color: "var(--supplier-instawork)",
    integration: "api",
    integrationDetail: "API connection: shifts, workers, clock-ins and timesheets sync hourly.",
    syncedUploads: ["professionals", "timesheets"],
    isInstawork: true,
    tagline: "On-demand hospitality staffing",
    cityIds: ["chi", "atl", "dal"],
    coiExpiresInDays: 241,
    contactName: "Marcus Lee",
    contactEmail: "enterprise@instawork.com",
    profile: { fillRate: 0.9, hoursToFill: 7, noShowRate: 0.027, compliance: 0.95, payIndex: 1.02, markupPct: 35, share: 0.3 },
    contract: { vaPct: 12, vaTiers: [[0, 8], [2_000_000, 10], [4_000_000, 12]], netDays: 30, years: 3 },
  },
  {
    id: "metro",
    name: "Metro Event Staff",
    shortName: "Metro",
    initials: "ME",
    color: "var(--supplier-metro)",
    integration: "csv",
    integrationDetail: "CSV upload: everything arrives as files uploaded by the Metro team.",
    syncedUploads: [],
    isInstawork: false,
    tagline: "Budget event labor",
    cityIds: ["chi", "atl", "dal"],
    coiExpiresInDays: 9,
    contactName: "Luis Ortega",
    contactEmail: "luis@metroeventstaff.example",
    profile: { fillRate: 0.74, hoursToFill: 26, noShowRate: 0.068, compliance: 0.85, payIndex: 0.96, markupPct: 38, share: 0.12 },
    contract: { vaPct: 8, vaTiers: [[0, 5], [1_500_000, 8], [3_000_000, 10]], netDays: 15, years: 1 },
  },
]

export const REQUIREMENTS: { id: RequirementId; label: string; short: string; description: string; renews: boolean }[] = [
  {
    id: "background",
    label: "Background check",
    short: "Background",
    description: "Criminal history, SSN trace and sex offender registry check. Renewed every 12 months.",
    renews: true,
  },
  {
    id: "i9",
    label: "I-9 / work authorization",
    short: "I-9",
    description: "Identity and employment eligibility verified (E-Verify). Required before any shift.",
    renews: false,
  },
  {
    id: "orientation",
    label: "Compass orientation",
    short: "Orientation",
    description: "Compass code of conduct, safety and allergen awareness training. Completed once.",
    renews: false,
  },
  {
    id: "foodHandler",
    label: "Food handler card",
    short: "Food handler",
    description: "State-approved food handler certificate. Required for positions that handle food.",
    renews: true,
  },
  {
    id: "alcohol",
    label: "Alcohol server cert",
    short: "Alcohol cert",
    description: "BASSET (IL), TIPS or TABC certificate. Required for positions that serve alcohol.",
    renews: true,
  },
]

const SHIPPED_WORKSPACES: Workspace[] = [
  {
    id: "ws-levy",
    kind: "buyer",
    buyerId: "levy-chi",
    name: "Levy · Chicago",
    sublabel: "Buyer · 4 locations",
    user: { name: "Jordan Ellis", firstName: "Jordan", title: "Director of Operations", email: "jordan.ellis@levy.example" },
  },
  {
    id: "ws-levy-dm",
    kind: "buyer",
    buyerId: "levy-chi",
    name: "Levy · Chicago",
    sublabel: "Buyer · District approvals",
    user: { name: "Dana Ruiz", firstName: "Dana", title: "District Manager", email: "dana.ruiz@levy.example" },
    approves: ["loc-lfs", "loc-wla", "loc-rcc", "loc-nsb"],
  },
  {
    id: "ws-chartwells",
    kind: "buyer",
    buyerId: "chartwells-south",
    name: "Chartwells · South",
    sublabel: "Buyer · 3 locations",
    user: { name: "Alicia Moreno", firstName: "Alicia", title: "Regional Dining Manager", email: "alicia.moreno@chartwells.example" },
  },
  {
    id: "ws-compass",
    kind: "compass",
    name: "Compass Group USA",
    sublabel: "Program office",
    user: { name: "Priya Raman", firstName: "Priya", title: "Flexible Labor Program Manager", email: "priya.raman@compass.example" },
  },
  {
    id: "ws-crewline",
    kind: "supplier",
    supplierId: "crewline",
    name: "Crewline Staffing",
    sublabel: "Agency · API connected",
    user: { name: "Devon Brooks", firstName: "Devon", title: "Account Manager", email: "devon@crewline.example" },
  },
  {
    id: "ws-harbor",
    kind: "supplier",
    supplierId: "harbor",
    name: "Harbor Hospitality",
    sublabel: "Agency · CSV uploads",
    user: { name: "Renee Park", firstName: "Renee", title: "Client Services Lead", email: "renee@harborhospitality.example" },
  },
  {
    id: "ws-instawork",
    kind: "supplier",
    supplierId: "instawork",
    name: "Instawork",
    sublabel: "Agency · API connected",
    user: { name: "Marcus Lee", firstName: "Marcus", title: "Enterprise Operations", email: "marcus.lee@instawork.com" },
  },
  {
    id: "ws-metro",
    kind: "supplier",
    supplierId: "metro",
    name: "Metro Event Staff",
    sublabel: "Agency · CSV uploads",
    user: { name: "Luis Ortega", firstName: "Luis", title: "Operations Lead", email: "luis@metroeventstaff.example" },
  },
]

export const DEFAULT_WORKSPACE_ID = "ws-levy"

/** A buyer's line counts its locations as they are now, onboarded units included. */
export const sublabelOf = (ws: Workspace) => {
  if (ws.kind !== "buyer" || ws.approves?.length) return ws.sublabel
  const n = locationsFor(ws.buyerId).length
  return `Buyer · ${n} location${n === 1 ? "" : "s"}`
}

/** The organization a workspace belongs to: "compass", "buyer:<id>" or "supplier:<id>". */
export const orgOf = (ws: Pick<Workspace, "kind" | "buyerId" | "supplierId">) =>
  ws.kind === "compass" ? "compass" : ws.kind === "buyer" ? `buyer:${ws.buyerId}` : `supplier:${ws.supplierId}`

export interface TeamMember {
  name: string
  title: string
  role: string
}

const TEAMS: Record<string, TeamMember[]> = {
  "buyer:levy-chi": [
    { name: "Jordan Ellis", title: "Director of Operations", role: "Admin" },
    { name: "Dana Ruiz", title: "District Manager", role: "Approves orders" },
    { name: "Sam Whitfield", title: "Venue Manager, Lakefront Stadium", role: "Can book" },
    { name: "Erin Cho", title: "Supervisor, West Loop Arena", role: "Can approve hours" },
    { name: "Marco Ruiz", title: "Controller", role: "Finance" },
  ],
  "buyer:chartwells-south": [
    { name: "Alicia Moreno", title: "Regional Dining Manager", role: "Admin" },
    { name: "Devin Hart", title: "Executive Chef, Peachtree", role: "Can book" },
    { name: "Priya Nair", title: "Finance Manager", role: "Finance" },
  ],
  compass: [
    { name: "Priya Raman", title: "Flexible Labor Program Manager", role: "Program admin" },
    { name: "Tom Becker", title: "Accounts Payable Lead", role: "Finance" },
    { name: "Lena Ortiz", title: "Compliance Manager", role: "Compliance" },
  ],
}

export function teamFor(ws: Workspace): TeamMember[] {
  return (
    TEAMS[orgOf(ws)] ?? [
      { name: ws.user.name, title: ws.user.title, role: "Admin" },
      { name: "Jamie Park", title: "Staffing Coordinator", role: "Operations" },
      { name: "Chris Valdez", title: "Billing Specialist", role: "Finance" },
    ]
  )
}

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))

interface Registry {
  locations: Location[]
  suppliers: Supplier[]
  workspaces: Workspace[]
  locationMap: Map<string, Location>
  supplierMap: Map<string, Supplier>
  workspaceMap: Map<string, Workspace>
}

declare global {
  var __irisRegistry: Registry | undefined
}

/**
 * Units, agencies and their workspaces live on one object per process: Next can load this module once per route
 * bundle, and every copy has to see the same onboarded entries.
 */
const registry = (globalThis.__irisRegistry ??= {
  locations: [...SHIPPED_LOCATIONS],
  suppliers: [...SHIPPED_SUPPLIERS],
  workspaces: [...SHIPPED_WORKSPACES],
  locationMap: byId(SHIPPED_LOCATIONS),
  supplierMap: byId(SHIPPED_SUPPLIERS),
  workspaceMap: byId(SHIPPED_WORKSPACES),
})

export const LOCATIONS: Location[] = registry.locations
export const SUPPLIERS: Supplier[] = registry.suppliers
export const WORKSPACES: Workspace[] = registry.workspaces

const cityMap = byId(CITIES)
const buyerMap = byId(BUYERS)
const positionMap = byId(POSITIONS)
const locationMap = registry.locationMap
const supplierMap = registry.supplierMap
const workspaceMap = registry.workspaceMap

const SHIPPED = { locations: SHIPPED_LOCATIONS, suppliers: SHIPPED_SUPPLIERS, workspaces: SHIPPED_WORKSPACES }

const refill = <T extends { id: string }>(list: T[], map: Map<string, T>, shipped: T[], added: T[] = []) => {
  const known = new Set(shipped.map((x) => x.id))
  list.length = 0
  list.push(...shipped, ...added.filter((x) => !known.has(x.id)))
  map.clear()
  for (const x of list) map.set(x.id, x)
}

/**
 * Points every lookup at the units and agencies onboarded in this data, beside the ones Iris shipped with. The lists
 * and maps here are module state shared by the whole process, so this runs whenever the data changes: on the server
 * after each change to the tenant (one tenant per process), and in the browser before new data renders.
 */
export function syncDirectory(directory?: Partial<Directory>) {
  refill(LOCATIONS, locationMap, SHIPPED.locations, directory?.locations)
  refill(SUPPLIERS, supplierMap, SHIPPED.suppliers, directory?.suppliers)
  refill(WORKSPACES, workspaceMap, SHIPPED.workspaces, directory?.workspaces)
}

export const emptyDirectory = (): Directory => ({ locations: [], suppliers: [], workspaces: [] })

/** The market a ZIP code belongs to: listed outright, or sharing its first three digits with one that is. */
export const marketForZip = (zip: string) =>
  CITIES.find((c) => c.zips.includes(zip)) ?? CITIES.find((c) => c.zips.some((z) => z.slice(0, 3) === zip.slice(0, 3)))

export const city = (id: string) => cityMap.get(id) ?? CITIES[0]
export const buyer = (id: string) => buyerMap.get(id) ?? BUYERS[0]
export const location = (id: string) => locationMap.get(id) ?? LOCATIONS[0]
export const position = (id: string) => positionMap.get(id) ?? POSITIONS[0]
export const supplier = (id: string) => supplierMap.get(id) ?? SUPPLIERS[0]
export const workspace = (id: string) => workspaceMap.get(id) ?? WORKSPACES[0]

/** The levels Compass files a unit under, top down. */
export const ORG_LEVELS = ["Super sector", "Sector", "Region", "District"]

const SPORTS_VENUES = new Set(["Stadium", "Arena", "Ballpark"])

/** The district a unit reports into: a Levy market's sports venues or its event venues, or a Chartwells city's campuses. */
export function districtOf(loc: Pick<Location, "buyerId" | "cityId" | "kind">) {
  const where = city(loc.cityId).name
  if (buyer(loc.buyerId).brand !== "Levy") return `${where} Campuses`
  return SPORTS_VENUES.has(loc.kind) ? `${where} Sports` : `${where} Events`
}

/** Where a unit sits in Compass, one entry per level in `ORG_LEVELS`. */
export function orgPath(loc: Pick<Location, "buyerId" | "cityId" | "kind">) {
  const b = buyer(loc.buyerId)
  const district = districtOf(loc)
  return [
    { id: `s:${b.sector}`, name: b.sector },
    { id: `b:${b.brand}`, name: b.brand },
    { id: `r:${b.id}`, name: b.name },
    { id: `t:${b.id}:${district}`, name: district },
  ]
}

export const termsOf = (supplierId: string): ContractTerms => supplier(supplierId).contract ?? { vaPct: 0, netDays: PROGRAM.paymentTermsDays, years: 1 }

/** The VA tier a year's spend reaches, and the next one up if there is one. */
export function vaTier(terms: ContractTerms, spend: number) {
  const tiers = terms.vaTiers ?? [[0, terms.vaPct]]
  const at = tiers.filter(([from]) => spend >= from).at(-1) ?? tiers[0]
  const next = tiers.find(([from]) => from > spend)
  return { pct: at[1], next: next && { from: next[0], pct: next[1] }, tiers }
}

/** What a rate really costs Compass once the agency's VA rebate comes back. */
export const afterVa = (rate: number, vaPct: number) => rate * (1 - vaPct / 100)

export const findCity = (id: string) => cityMap.get(id)
export const findLocation = (id: string) => locationMap.get(id)
export const findPosition = (id: string) => positionMap.get(id)
export const findSupplier = (id: string) => supplierMap.get(id)
export const findWorkspace = (id: string) => workspaceMap.get(id)

/** The department work is charged to: the one named, else the one the role belongs to, else none. */
export function departmentOf(locationId: string, departmentId?: string, positionId?: string): Department | undefined {
  const list = findLocation(locationId)?.departments ?? []
  return list.find((d) => d.id === departmentId) ?? (positionId ? list.find((d) => d.positionIds?.includes(positionId)) : undefined)
}

/** The cost center an invoice line is charged to: its department's, or the unit's when it has none. */
export const costCenterOf = (locationId: string, departmentId?: string, positionId?: string) =>
  departmentOf(locationId, departmentId, positionId)?.costCenter || location(locationId).costCenter

export const policyFor = (buyerId: string) => SECTOR_POLICIES.find((p) => p.buyerId === buyerId) ?? SECTOR_POLICIES[0]

/** Who approves over-budget orders at a location. Nobody while the program runs without budget approvals. */
export const approversFor = (locationId: string) =>
  PROGRAM.budgetApprovals ? WORKSPACES.filter((w) => w.approves?.includes(locationId) || findLocation(locationId)?.approverIds?.includes(w.id)) : []

export const locationsFor = (buyerId?: string) =>
  buyerId ? LOCATIONS.filter((l) => l.buyerId === buyerId) : LOCATIONS

export const citiesForBuyer = (buyerId?: string) => {
  const ids = new Set(locationsFor(buyerId).map((l) => l.cityId))
  return CITIES.filter((c) => ids.has(c.id))
}

export const cityLabel = (id: string) => {
  const c = city(id)
  return `${c.name}, ${c.state}`
}

/** Positions whose duties need a food handler card or an alcohol cert get those requirements, and a unit can add more. */
export const requirementsFor = (positionIds: string[], locationId?: string): RequirementId[] => {
  const base: RequirementId[] = ["background", "i9", "orientation"]
  const positions = positionIds.map((id) => position(id))
  const unit = locationId ? (findLocation(locationId)?.requires ?? []) : []
  if (positions.some((p) => p.foodHandler) || unit.includes("foodHandler")) base.push("foodHandler")
  if (positions.some((p) => p.alcohol) || unit.includes("alcohol")) base.push("alcohol")
  return base
}

export const requirementLabel = (id: RequirementId) => REQUIREMENTS.find((r) => r.id === id)?.label ?? id

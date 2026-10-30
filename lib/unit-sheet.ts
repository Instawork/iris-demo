import type { UnitInput } from "@/lib/domain/commands"
import { BUYERS, LOCATIONS, departmentsFor, marketForZip, rolesFor } from "@/lib/reference"

/**
 * Compass's location roster read into units in one go. Each row is a customer with its financial code: Iris files it
 * under its sector and market, gives it a cost center for each department, and holds back the rows it can't place
 * with the reason, the way adding one by hand would.
 */

export const ROSTER_HEADERS = [
  "Customer Group Code",
  "Customer Group",
  "Sector Code",
  "Sector",
  "Division Code",
  "Division",
  "Region Code",
  "Region",
  "District Code",
  "District",
  "Customer Code",
  "Customer",
  "Main Contact Address1",
  "Main Contact Address2",
  "Main Contact City",
  "Main Contact State",
  "Main Contact Postal Code",
  "Financial Code",
  "Account Manager",
  "Account Manager Department",
  "Division Manager",
  "Division Manager Department",
  "Business Channel",
  "New Addition",
] as const

export type RosterHeader = (typeof ROSTER_HEADERS)[number]
export type RosterRow = Record<RosterHeader, string>

export interface UnitSheetLine {
  line: number
  row: RosterRow
  input?: UnitInput
  cityId?: string
  issue?: string
}

export const UNIT_SHEET_FILE = "Compass VMS Locations - November Roster.csv"

const ORG = {
  levy: { sector: ["CLV-11020", "Levy Sector"], division: ["CLV-21410", "Levy Central Division"], region: ["CLV-31415", "Levy Chicago Region"] },
  chwHe: { sector: ["CLV-11040", "Chartwells Sector"], division: ["CLV-21620", "Higher Education Division (Chartwells Sector)"], region: ["CLV-31622", "HE South Region"] },
  chwK12: { sector: ["CLV-11040", "Chartwells Sector"], division: ["CLV-21640", "Schools Division"], region: ["CLV-31644", "Schools South Region"] },
} as const

let customer = 718200
const roster = (org: keyof typeof ORG, name: string, address: string, city: string, state: string, zip: string, code: string, channel: string, manager: string): RosterRow => {
  const o = ORG[org]
  return {
    "Customer Group Code": "CLV-4",
    "Customer Group": "Compass",
    "Sector Code": o.sector[0],
    Sector: o.sector[1],
    "Division Code": o.division[0],
    Division: o.division[1],
    "Region Code": o.region[0],
    Region: o.region[1],
    "District Code": "",
    District: "",
    "Customer Code": `CUS-${customer++}`,
    Customer: name,
    "Main Contact Address1": address,
    "Main Contact Address2": "",
    "Main Contact City": city,
    "Main Contact State": state,
    "Main Contact Postal Code": zip,
    "Financial Code": code,
    "Account Manager": manager,
    "Account Manager Department": manager ? "Business Needs" : "",
    "Division Manager": "",
    "Division Manager Department": "",
    "Business Channel": channel,
    "New Addition": "Yes",
  }
}

export const SAMPLE_UNIT_SHEET: RosterRow[] = [
  roster("chwHe", "HE South Region Overhead 72900", "75 Fifth St NW", "Atlanta", "GA", "30308", "72900", "Non Food", ""),
  roster("chwHe", "Peachtree University Library Café", "266 Fourth St NW", "Atlanta", "GA", "30313", "72230", "Education", "Dana Whitfield"),
  roster("chwHe", "Peachtree University Athletic Village", "150 Bobby Dodd Way NW", "Atlanta", "GA", "30332", "72240", "Education", "Dana Whitfield"),
  roster("chwHe", "Peachtree University West Commons", "860 Hemphill Ave NW", "Atlanta", "GA", "30318", "72250", "Education", "Dana Whitfield"),
  roster("chwHe", "Midtown College Residence Hall", "520 Spring St NW", "Atlanta", "GA", "30308", "72260", "Education", "Dana Whitfield"),
  roster("chwHe", "Midtown College Library Café", "90 Fifth St NW", "Atlanta", "GA", "30308", "72260", "Education", "Dana Whitfield"),
  roster("chwK12", "Westside Prep Dining Hall", "1100 Marietta St NW", "Atlanta", "GA", "30318-5521", "72270", "Education", "Marcus Bell"),
  roster("chwK12", "Inman Park Academy", "412 Elizabeth St NE", "Atlanta", "GA", "30307", "72280", "Education", "Marcus Bell"),
  roster("chwK12", "Grant Park High School", "680 Cherokee Ave SE", "Atlanta", "GA", "30312", "72290", "Education", "Marcus Bell"),
  roster("chwK12", "Buckhead Prep Commons", "3100 Peachtree Rd NE", "Atlanta", "GA", "30305", "72205", "Education", "Marcus Bell"),
  roster("chwK12", "Virginia Highland Middle School", "1010 Highland Ave NE", "Atlanta", "GA", "30306", "72215", "Education", "Marcus Bell"),
  roster("chwHe", "Trinity Tech Engineering Café", "3200 Dyer St", "Dallas", "TX", "75205", "72320", "Education", "Renee Ortiz"),
  roster("chwHe", "Trinity Tech Residence Commons", "3300 Daniel Ave", "Dallas", "TX", "75205", "72330", "Education", "Renee Ortiz"),
  roster("chwHe", "Uptown College Dining Hall", "2500 McKinney Ave", "Dallas", "TX", "75201", "72340", "Education", "Renee Ortiz"),
  roster("chwK12", "Deep Ellum Arts Academy", "2800 Main St", "Dallas", "TX", "75226", "72350", "Education", "Renee Ortiz"),
  roster("chwK12", "Lakewood High School", "9100 Lakewood Blvd", "Dallas", "TX", "75214", "72360", "Education", "Renee Ortiz"),
  roster("chwK12", "Oak Lawn Prep", "3800 Oak Lawn Ave", "Dallas", "TX", "75219", "72370", "Education", "Renee Ortiz"),
  roster("chwK12", "Bishop Arts Middle School", "400 N Bishop Ave", "Dallas", "TX", "75208", "72380", "Education", "Renee Ortiz"),
  roster("chwHe", "Medical District Campus Café", "5300 Harry Hines Blvd", "Dallas", "TX", "75235", "72390", "Education", "Renee Ortiz"),
  roster("chwHe", "Design District Culinary Institute", "1400 Dragon St", "Dallas", "TX", "75207", "72305", "Education", "Renee Ortiz"),
  roster("chwK12", "Victory Park Academy", "2400 Victory Ave", "Dallas", "TX", "75219", "72315", "Education", "Renee Ortiz"),
  roster("chwHe", "Rice Village Commons", "2400 Rice Blvd", "Houston", "TX", "77005", "72410", "Education", "Renee Ortiz"),
  roster("levy", "Lakeshore Amphitheater", "1300 S Lake Shore Dr", "Chicago", "IL", "60605", "74460", "Sports Venues", "Grace Kowalski"),
  roster("levy", "Wacker Drive Conference Center", "222 W Wacker Dr", "Chicago", "IL", "60606", "74470", "Hospitality and Leisure", "Grace Kowalski"),
  roster("levy", "South Loop Fieldhouse", "1500 S Wabash Ave", "Chicago", "IL", "60616", "74480", "Sports Venues", "Grace Kowalski"),
  roster("levy", "River North Ballroom", "455 N Wells St", "Chicago", "IL", "60654", "74490", "Hospitality and Leisure", "Grace Kowalski"),
  roster("levy", "Wrigleyville Sports Hall", "3600 N Clark St", "Chicago", "IL", "60613", "74510", "Sports Venues", "Grace Kowalski"),
]

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** The kind of unit a row is, from its business channel. */
function kindOf(r: RosterRow) {
  const channel = r["Business Channel"]
  if (/education/i.test(channel)) return "Campus dining"
  if (/hospitality/i.test(channel)) return "Convention center"
  if (/sports/i.test(channel)) return /arena|fieldhouse|hall/i.test(r.Customer) ? "Arena" : "Stadium"
  return "Corporate dining"
}

/** The unit a row becomes: the roles its kind orders, and a department under its cost center for each. */
export function unitFromRow(r: RosterRow, buyerId: string): UnitInput {
  const kind = kindOf(r)
  const positionIds = rolesFor(kind)
  const costCenter = r["Financial Code"].trim().toUpperCase()
  return {
    buyerId,
    name: r.Customer.trim(),
    kind,
    address: [r["Main Contact Address1"], r["Main Contact Address2"], r["Main Contact City"], r["Main Contact State"]].map((s) => s.trim()).filter(Boolean).join(", "),
    zip: r["Main Contact Postal Code"].trim().slice(0, 5),
    costCenter,
    positionIds,
    departments: departmentsFor(kind, costCenter)
      .filter((d) => !d.positionIds || d.positionIds.some((p) => positionIds.includes(p)))
      .map((d) => ({ name: d.name, costCenter: d.costCenter, positionIds: d.positionIds })),
  }
}

/** Every cost center a roster's units would add: one per unit and one per department. */
export const costCentersIn = (lines: UnitSheetLine[]) => lines.reduce((n, l) => n + (l.input ? 1 + (l.input.departments?.length ?? 0) : 0), 0)

/** Reads each row against the units already on Iris and the rows above it, the same checks adding one by hand runs. */
export function readUnitSheet(rows: RosterRow[]): UnitSheetLine[] {
  const names = new Set(LOCATIONS.map((l) => key(l.name)))
  const codes = new Map<string, string>()
  for (const l of LOCATIONS) for (const c of [l.costCenter, ...(l.departments ?? []).map((d) => d.costCenter)]) codes.set(c.toUpperCase(), l.name)
  return rows.map((r, i) => {
    const line = i + 2
    const name = r.Customer.trim()
    const brand = r.Sector.replace(/\s+sector$/i, "").trim()
    const zip = r["Main Contact Postal Code"].trim().slice(0, 5)
    const market = /^\d{5}$/.test(zip) ? marketForZip(zip) : undefined
    const b = market && BUYERS.find((x) => key(x.brand) === key(brand) && LOCATIONS.some((l) => l.buyerId === x.id && l.cityId === market.id))
    const costCenter = r["Financial Code"].trim().toUpperCase()
    const issue = !name
      ? "No customer name"
      : /non food/i.test(r["Business Channel"]) || /\boverhead\b/i.test(name)
        ? "An overhead account, not a place that orders shifts"
        : names.has(key(name))
          ? `${name} is already on Iris`
          : !/^\d{5}$/.test(zip)
            ? "The postal code needs five digits"
            : !market
              ? `No agency on Iris covers ${r["Main Contact City"] || zip} yet`
              : !b
                ? `No ${brand || "business"} buyer in ${market.name} on Iris yet`
                : !costCenter
                  ? "No financial code"
                  : codes.has(costCenter)
                    ? `${costCenter} already belongs to ${codes.get(costCenter)}`
                    : undefined
    if (issue || !b || !market) return { line, row: r, issue }
    const input = unitFromRow(r, b.id)
    const taken = (input.departments ?? []).find((d) => codes.has(d.costCenter))
    if (taken) return { line, row: r, issue: `${taken.costCenter} already belongs to ${codes.get(taken.costCenter)}` }
    names.add(key(name))
    for (const c of [costCenter, ...(input.departments ?? []).map((d) => d.costCenter)]) codes.set(c, name)
    return { line, row: r, input, cityId: market.id }
  })
}

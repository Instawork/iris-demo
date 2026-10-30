import type { UnitInput } from "@/lib/domain/commands"
import { BUYERS, LOCATIONS, departmentsFor, marketForZip, rolesFor } from "@/lib/reference"

/**
 * A sheet of locations read into units in one go: each row files under its business and market, with a cost center
 * for the unit and one for each department. Rows Iris can't place are held back with the reason, the rest are added.
 */

export interface UnitSheetRow {
  name: string
  business: string
  kind: string
  address: string
  zip: string
  costCenter: string
}

export interface UnitSheetLine {
  line: number
  row: UnitSheetRow
  input?: UnitInput
  cityId?: string
  issue?: string
}

export const UNIT_SHEET_FILE = "compass-locations-fy27.xlsx"

export const UNIT_SHEET_HEADERS = ["Location", "Business", "Type", "Address", "ZIP", "Cost center"]

const row = (name: string, business: string, kind: string, address: string, zip: string, costCenter: string): UnitSheetRow => ({ name, business, kind, address, zip, costCenter })

export const SAMPLE_UNIT_SHEET: UnitSheetRow[] = [
  row("Peachtree University Library Café", "Chartwells South", "Campus dining", "266 Fourth St NW, Atlanta, GA", "30313", "CHW-2230"),
  row("Peachtree University Athletic Village", "Chartwells South", "Campus dining", "150 Bobby Dodd Way NW, Atlanta, GA", "30332", "CHW-2240"),
  row("Peachtree University West Commons", "Chartwells South", "Campus dining", "860 Hemphill Ave NW, Atlanta, GA", "30318", "CHW-2250"),
  row("Midtown College Residence Hall", "Chartwells South", "Campus dining", "520 Spring St NW, Atlanta, GA", "30308", "CHW-2260"),
  row("Midtown College Library Café", "Chartwells South", "Campus dining", "90 Fifth St NW, Atlanta, GA", "30308", "CHW-2220"),
  row("Westside Prep Dining Hall", "Chartwells South", "Campus dining", "1100 Marietta St NW, Atlanta, GA", "30318", "CHW-2270"),
  row("Inman Park Academy", "Chartwells South", "Campus dining", "412 Elizabeth St NE, Atlanta, GA", "30307", "CHW-2280"),
  row("Grant Park High School", "Chartwells South", "Campus dining", "680 Cherokee Ave SE, Atlanta, GA", "30312", "CHW-2290"),
  row("Buckhead Prep Commons", "Chartwells South", "Campus dining", "3100 Peachtree Rd NE, Atlanta, GA", "30305", "CHW-2205"),
  row("Virginia Highland Middle School", "Chartwells South", "Campus dining", "1010 Highland Ave NE, Atlanta, GA", "30306", "CHW-2215"),
  row("Trinity Tech Engineering Café", "Chartwells South", "Campus dining", "3200 Dyer St, Dallas, TX", "75205", "CHW-2320"),
  row("Trinity Tech Residence Commons", "Chartwells South", "Campus dining", "3300 Daniel Ave, Dallas, TX", "75205", "CHW-2330"),
  row("Uptown College Dining Hall", "Chartwells South", "Campus dining", "2500 McKinney Ave, Dallas, TX", "75201", "CHW-2340"),
  row("Deep Ellum Arts Academy", "Chartwells South", "Campus dining", "2800 Main St, Dallas, TX", "75226", "CHW-2350"),
  row("Lakewood High School", "Chartwells South", "Campus dining", "9100 Lakewood Blvd, Dallas, TX", "75214", "CHW-2360"),
  row("Oak Lawn Prep", "Chartwells South", "Campus dining", "3800 Oak Lawn Ave, Dallas, TX", "75219", "CHW-2370"),
  row("Bishop Arts Middle School", "Chartwells South", "Campus dining", "400 N Bishop Ave, Dallas, TX", "75208", "CHW-2380"),
  row("Medical District Campus Café", "Chartwells South", "Campus dining", "5300 Harry Hines Blvd, Dallas, TX", "75235", "CHW-2390"),
  row("Design District Culinary Institute", "Chartwells South", "Campus dining", "1400 Dragon St, Dallas, TX", "75207", "CHW-2305"),
  row("Victory Park Academy", "Chartwells South", "Campus dining", "2400 Victory Ave, Dallas, TX", "75219", "CHW-2315"),
  row("Rice Village Commons", "Chartwells South", "Campus dining", "2400 Rice Blvd, Houston, TX", "77005", "CHW-2410"),
  row("Lakeshore Amphitheater", "Levy Chicago", "Arena", "1300 S Lake Shore Dr, Chicago, IL", "60605", "LEV-4460"),
  row("Wacker Drive Conference Center", "Levy Chicago", "Convention center", "222 W Wacker Dr, Chicago, IL", "60606", "LEV-4470"),
  row("South Loop Fieldhouse", "Levy Chicago", "Arena", "1500 S Wabash Ave, Chicago, IL", "60616", "LEV-4480"),
  row("River North Ballroom", "Levy Chicago", "Convention center", "455 N Wells St, Chicago, IL", "60654", "LEV-4490"),
  row("Wrigleyville Sports Hall", "Levy Chicago", "Arena", "3600 N Clark St, Chicago, IL", "60613", "LEV-4510"),
]

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** The unit a row becomes: the roles its kind orders, and a department under its cost center for each. */
export function unitFromRow(r: UnitSheetRow, buyerId: string): UnitInput {
  const positionIds = rolesFor(r.kind)
  const costCenter = r.costCenter.trim().toUpperCase()
  return {
    buyerId,
    name: r.name.trim(),
    kind: r.kind.trim(),
    address: r.address.trim(),
    zip: r.zip.trim(),
    costCenter,
    positionIds,
    departments: departmentsFor(r.kind, costCenter)
      .filter((d) => !d.positionIds || d.positionIds.some((p) => positionIds.includes(p)))
      .map((d) => ({ name: d.name, costCenter: d.costCenter, positionIds: d.positionIds })),
  }
}

/** Every cost center a sheet's units would add: one per unit and one per department. */
export const costCentersIn = (lines: UnitSheetLine[]) => lines.reduce((n, l) => n + (l.input ? 1 + (l.input.departments?.length ?? 0) : 0), 0)

/** Reads each row against the units already on Iris and the rows above it, the same checks adding one by hand runs. */
export function readUnitSheet(rows: UnitSheetRow[]): UnitSheetLine[] {
  const names = new Set(LOCATIONS.map((l) => key(l.name)))
  const codes = new Map<string, string>()
  for (const l of LOCATIONS) for (const c of [l.costCenter, ...(l.departments ?? []).map((d) => d.costCenter)]) codes.set(c.toUpperCase(), l.name)
  return rows.map((r, i) => {
    const line = i + 2
    const b = BUYERS.find((x) => key(x.name) === key(r.business) || key(`${x.brand}${x.region}`) === key(r.business))
    const zip = r.zip.trim()
    const market = /^\d{5}$/.test(zip) ? marketForZip(zip) : undefined
    const costCenter = r.costCenter.trim().toUpperCase()
    const issue = !r.name.trim()
      ? "No location name"
      : names.has(key(r.name))
        ? `${r.name.trim()} is already on Iris`
        : !b
          ? `No business called ${r.business || "that"} on Iris`
          : !/^\d{5}$/.test(zip)
            ? "The ZIP code needs five digits"
            : !market
              ? `No agency on Iris covers ${zip} yet`
              : !costCenter
                ? "No cost center"
                : codes.has(costCenter)
                  ? `${costCenter} already belongs to ${codes.get(costCenter)}`
                  : undefined
    if (issue || !b || !market) return { line, row: r, issue }
    const input = unitFromRow(r, b.id)
    const taken = (input.departments ?? []).find((d) => codes.has(d.costCenter))
    if (taken) return { line, row: r, issue: `${taken.costCenter} already belongs to ${codes.get(taken.costCenter)}` }
    names.add(key(r.name))
    for (const c of [costCenter, ...(input.departments ?? []).map((d) => d.costCenter)]) codes.set(c, r.name.trim())
    return { line, row: r, input, cityId: market.id }
  })
}

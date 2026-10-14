const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

export const money = (n: number) => usd.format(Number.isFinite(n) ? n : 0)

export const moneyWhole = (n: number) => usdWhole.format(Number.isFinite(n) ? n : 0)

export const moneyCompact = (n: number) => `$${compact.format(Number.isFinite(n) ? n : 0)}`

export const rate = (n: number) => `${money(n)}/hr`

export const pct = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits)}%`

export const pctValue = (value: number, digits = 1) => `${value.toFixed(digits)}%`

export const hours = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} hrs`

export const round2 = (n: number) => Math.round(n * 100) / 100

export const roundTo = (n: number, step: number) => Math.round(n / step) * step

export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`

export const shortName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName[0]}.`

/** Markup expressed as a percentage of Pro pay, the way agencies quote it. */
export const markupFrom = (proRate: number, billRate: number) =>
  proRate > 0 ? round2(((billRate - proRate) / proRate) * 100) : 0

export const billFrom = (proRate: number, markupPct: number) => round2(proRate * (1 + markupPct / 100))

export const proFrom = (billRate: number, markupPct: number) => round2(billRate / (1 + markupPct / 100))

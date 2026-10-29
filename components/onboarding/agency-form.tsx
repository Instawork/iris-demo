"use client"

import { useRouter } from "next/navigation"
import { Check, FileCheck2, FileSpreadsheet, Paperclip, Upload } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { Surface } from "@/components/common/surface"
import { CheckRow, Field, Line, Section, inputClass } from "@/components/onboarding/steps"
import { Button } from "@/components/ui/button"
import { useData } from "@/hooks/use-app"
import { addDaysISO, formatDateFull, todayISO } from "@/lib/dates"
import { billFrom, money, plural, roundTo } from "@/lib/format"
import { BUYERS, CITIES, LOCATIONS, POSITIONS, PROGRAM, WORKSPACES, city, position } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import type { DemoData } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Adding an agency the way Compass contracts one, on one page: who to call, where and what it staffs, its insurance
 * and agreement, a rate card checked against what the other agencies charge, and its workers from the roster file it
 * sends. The summary beside the form fills in as you go. Approved buyers send it shifts right away.
 */

const DEFAULT_MARKUP = 32

type Name = { firstName: string; lastName: string }

const SAMPLE_NAMES = [
  "Maya Okafor", "Luis Herrera", "Grace Lindqvist", "Andre Baptiste", "Nadia Petrova", "Tomas Novak", "Keisha Grant", "Owen Gallagher", "Rosa Delgado",
  "Samir Haddad", "Lena Fischer", "Darnell Price", "Mei Tanaka", "Victor Morales", "Hannah Brooks", "Kofi Mensah", "Isabel Cruz", "Ethan Walsh",
]

/** Reads names from a roster export: a first and last name column, one name column, or the first two columns. */
function readRoster(text: string): Name[] {
  const rows = text.split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))).filter((r) => r.some(Boolean))
  if (!rows.length) return []
  const head = rows[0].map((c) => c.toLowerCase().replace(/[^a-z]/g, ""))
  const hasHead = head.some((c) => c.includes("name"))
  const first = head.findIndex((c) => c.startsWith("first"))
  const last = head.findIndex((c) => c.startsWith("last"))
  const full = head.findIndex((c) => c === "name" || c === "fullname")
  return (hasHead ? rows.slice(1) : rows)
    .map((r): Name => {
      if (first >= 0 && last >= 0) return { firstName: r[first] ?? "", lastName: r[last] ?? "" }
      const whole = full >= 0 ? r[full] : r.length > 1 ? `${r[0]} ${r[1]}` : r[0]
      const [firstName, ...rest] = (whole ?? "").split(/\s+/)
      return { firstName: firstName ?? "", lastName: rest.join(" ") }
    })
    .filter((n) => n.firstName && n.lastName)
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** What the agencies already on Iris charge for a role in a market, as the middle of their rates. */
function marketRate(data: DemoData, cityId: string, positionId: string) {
  const cards = data.rateCards.filter((c) => c.cityId === cityId && c.positionId === positionId && c.status === "active")
  if (!cards.length) return undefined
  return { pay: median(cards.map((c) => c.proRate)), bill: median(cards.map((c) => c.billRate)), agencies: cards.length }
}

interface Form {
  name: string
  shortName: string
  contactName: string
  contactEmail: string
  csv: boolean
  api: boolean
  cityIds: string[]
  positionIds: string[]
  coiExpiresOn: string
  coiFile: string
  msaSigned: boolean
  rates: Record<string, { pay: string; markup: string }>
  roster?: { file: string; names: Name[] }
  /** Unset until picked, which means every buyer with a unit in the agency's markets. */
  buyerIds?: string[]
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

export function NewAgencyPage() {
  const data = useData()
  const router = useRouter()
  const onboardAgency = useStore((s) => s.onboardAgency)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Form>(() => ({
    name: "",
    shortName: "",
    contactName: "",
    contactEmail: "",
    csv: true,
    api: false,
    cityIds: ["chi"],
    positionIds: ["bartender", "barback", "concessions"],
    coiExpiresOn: addDaysISO(todayISO(), 240),
    coiFile: "",
    msaSigned: false,
    rates: {},
  }))
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const short = form.shortName.trim() || form.name.trim().split(/\s+/)[0] || "the agency"

  const rows = useMemo(
    () =>
      form.cityIds.flatMap((cityId) =>
        form.positionIds.map((positionId) => {
          const key = `${cityId}|${positionId}`
          const market = marketRate(data, cityId, positionId)
          const suggested = market ? roundTo(market.pay, 0.25) : roundTo(position(positionId).basePay * city(cityId).payIndex, 0.25)
          const entry = form.rates[key] ?? { pay: suggested.toFixed(2), markup: String(DEFAULT_MARKUP) }
          const pay = Number(entry.pay)
          const markup = Number(entry.markup)
          const bill = pay > 0 && markup >= 0 ? billFrom(pay, markup) : 0
          return { key, cityId, positionId, entry, pay, markup, bill, market, over: market && bill ? bill / market.bill - 1 : undefined }
        }),
      ),
    [data, form.cityIds, form.positionIds, form.rates],
  )
  const badRates = rows.filter((r) => !(r.pay >= 7.25) || !(r.markup >= 0))
  const above = rows.filter((r) => r.over !== undefined && r.over > 0.1).length
  const buyers = BUYERS.filter((b) => LOCATIONS.some((l) => l.buyerId === b.id && form.cityIds.includes(l.cityId)))
  const buyerIds = (form.buyerIds ?? buyers.map((b) => b.id)).filter((id) => buyers.some((b) => b.id === id))
  const categories = [...new Set(POSITIONS.map((p) => p.category))]

  const missing = [
    !form.name.trim() && "its legal name",
    !form.contactName.trim() && "a main contact",
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim()) && "a contact email",
    !(form.csv || form.api) && "a way to send hours",
    !form.cityIds.length && "a market",
    !form.positionIds.length && "a role",
    !(form.coiExpiresOn > todayISO()) && "insurance that hasn't expired",
    !form.msaSigned && "a signed agreement",
    badRates.length > 0 && "a pay rate and markup for every role",
  ].filter(Boolean) as string[]

  const submit = async () => {
    setBusy(true)
    const name = form.name.trim()
    const id = await onboardAgency({
      name,
      shortName: form.shortName.trim() || undefined,
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      integration: form.csv && form.api ? "both" : form.api ? "api" : "csv",
      cityIds: form.cityIds,
      positionIds: form.positionIds,
      coiExpiresOn: form.coiExpiresOn,
      coiFile: form.coiFile || undefined,
      msaSigned: form.msaSigned,
      rates: rows.map((r) => ({ cityId: r.cityId, positionId: r.positionId, proRate: r.pay, markupPct: r.markup })),
      buyerIds,
      roster: form.roster?.names.length ?? 0,
      rosterNames: form.roster?.names,
    })
    setBusy(false)
    if (!id) return
    const ws = WORKSPACES.find((w) => w.supplierId === id)
    toast.success(`${name} is on Iris`, {
      description: `${short} can sign in and take shifts from the buyers that approved it.`,
      action: ws
        ? {
            label: `Open Iris as ${short}`,
            onClick: () =>
              void setWorkspace(ws.id).then(() => router.push("/")),
          }
        : undefined,
    })
    router.push(`/agencies/${id}`)
  }

  return (
    <>
      <PageHeader className="pt-4" title="Add an agency" />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-tour="agency-form">
        <Surface elevated className="flex flex-col divide-y divide-border">
          <Section title="Agency">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal name">
                <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Northwind Event Staffing" className={inputClass} autoFocus />
              </Field>
              <Field label="Short name">
                <input value={form.shortName} onChange={(e) => set({ shortName: e.target.value })} placeholder={form.name.trim().split(/\s+/)[0] || "Northwind"} className={inputClass} />
              </Field>
              <Field label="Main contact">
                <input value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Alex Rivera" className={inputClass} />
              </Field>
              <Field label="Contact email">
                <input value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} placeholder="alex@northwindstaff.com" type="email" className={inputClass} />
              </Field>
            </div>
            <div className="flex flex-col gap-1">
              <span className="pb-1 text-caption-1 font-medium text-faded">Sends workers and hours by</span>
              <div className="flex gap-6">
                <CheckRow on={form.csv} onClick={() => set({ csv: !form.csv })}>
                  CSV uploads
                </CheckRow>
                <CheckRow on={form.api} onClick={() => set({ api: !form.api })}>
                  API connection
                </CheckRow>
              </div>
            </div>
          </Section>

          <Section title="Markets and roles">
            <div className="flex flex-col gap-1">
              <span className="pb-1 text-caption-1 font-medium text-faded">Markets</span>
              <div className="grid gap-x-6 sm:grid-cols-3">
                {CITIES.map((c) => (
                  <CheckRow key={c.id} on={form.cityIds.includes(c.id)} onClick={() => set({ cityIds: toggle(form.cityIds, c.id) })}>
                    {c.name}, {c.state}
                  </CheckRow>
                ))}
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              {categories.map((c) => (
                <div key={c} className="flex flex-col gap-1">
                  <span className="pb-1 text-caption-1 font-medium text-faded">{c}</span>
                  {POSITIONS.filter((p) => p.category === c).map((p) => (
                    <CheckRow key={p.id} on={form.positionIds.includes(p.id)} onClick={() => set({ positionIds: toggle(form.positionIds, p.id) })}>
                      {p.name}
                    </CheckRow>
                  ))}
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Paperwork"
            info={`Program terms apply: Net ${PROGRAM.paymentTermsDays} by ACH through Iris, and a background check, I-9 and Compass orientation for every worker.`}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Insurance expires" hint="Iris stops sending it shifts the day this lapses.">
                <input type="date" value={form.coiExpiresOn} min={addDaysISO(todayISO(), 1)} onChange={(e) => set({ coiExpiresOn: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Certificate of insurance">
                <span className="flex h-9 items-center gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-3 text-body-3 font-medium hover:bg-hover">
                    <Paperclip className="size-4" /> {form.coiFile ? "Replace" : "Attach"}
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => set({ coiFile: e.target.files?.[0]?.name ?? "" })} />
                  </label>
                  {form.coiFile && (
                    <span className="inline-flex min-w-0 items-center gap-1 text-caption-1 text-faded">
                      <FileCheck2 className="size-3.5 text-positive-fg" />
                      <span className="truncate">{form.coiFile}</span>
                    </span>
                  )}
                </span>
              </Field>
            </div>
            <CheckRow on={form.msaSigned} onClick={() => set({ msaSigned: !form.msaSigned })}>
              Master services agreement signed
            </CheckRow>
          </Section>

          <Section title="Rates" info="Each one starts at what agencies in the market already pay their workers.">
            {rows.length ? (
              <table className="w-full text-left text-body-3">
                <thead>
                  <tr className="text-caption-1 text-faded">
                    <th className="pb-2 font-medium">Role</th>
                    <th className="pb-2 font-medium">Pay</th>
                    <th className="pb-2 font-medium">Markup</th>
                    <th className="pb-2 text-right font-medium">Bill rate</th>
                    <th className="pb-2 text-right font-medium">Vs market</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t border-border/70">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{position(r.positionId).name}</span>
                        {form.cityIds.length > 1 && <span className="text-faded"> · {city(r.cityId).name}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1">
                          <span className="text-faded">$</span>
                          <input
                            value={r.entry.pay}
                            onChange={(e) => set({ rates: { ...form.rates, [r.key]: { ...r.entry, pay: e.target.value.replace(/[^\d.]/g, "") } } })}
                            aria-label={`${position(r.positionId).name} pay rate in ${city(r.cityId).name}`}
                            className={cn(inputClass, "h-8 w-20 tabular")}
                          />
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1">
                          <input
                            value={r.entry.markup}
                            onChange={(e) => set({ rates: { ...form.rates, [r.key]: { ...r.entry, markup: e.target.value.replace(/[^\d.]/g, "") } } })}
                            aria-label={`${position(r.positionId).name} markup in ${city(r.cityId).name}`}
                            className={cn(inputClass, "h-8 w-16 tabular")}
                          />
                          <span className="text-faded">%</span>
                        </span>
                      </td>
                      <td className="py-2 text-right font-semibold tabular">{r.bill ? money(r.bill) : "—"}</td>
                      <td className="py-2 pl-3 text-right tabular">
                        {r.over === undefined ? (
                          <Tip content="No other agency has a rate here yet">
                            <span className="text-subtle">—</span>
                          </Tip>
                        ) : (
                          <Tip content={`Market ${money(r.market!.bill)} across ${plural(r.market!.agencies, "agency", "agencies")}`}>
                            <span className={cn("font-medium", r.over > 0.1 ? "text-warning-fg" : r.over < 0.005 ? "text-positive-fg" : "text-faded")}>
                              {Math.round(r.over * 100) === 0 ? "At market" : `${r.over > 0 ? "+" : "−"}${Math.abs(Math.round(r.over * 100))}%`}
                            </span>
                          </Tip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="text-body-3 text-faded">Pick a market and a role to price.</span>
            )}
          </Section>

          <Section title="Workers">
            <RosterImport
              roster={form.roster}
              sampleFile={`${(form.shortName.trim() || form.name.trim().split(/\s+/)[0] || "agency").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-roster.csv`}
              onChange={(roster) => set({ roster })}
            />
          </Section>

          <Section title="Buyers that can send it shifts">
            {buyers.length ? (
              <div className="grid gap-x-6 sm:grid-cols-2">
                {buyers.map((b) => {
                  const units = LOCATIONS.filter((l) => l.buyerId === b.id && form.cityIds.includes(l.cityId)).length
                  return (
                    <CheckRow key={b.id} on={buyerIds.includes(b.id)} onClick={() => set({ buyerIds: toggle(buyerIds, b.id) })}>
                      {b.name}
                      <span className="text-faded">· {plural(units, "unit")}</span>
                    </CheckRow>
                  )
                })}
              </div>
            ) : (
              <span className="text-body-3 text-faded">No buyer has a unit in these markets yet.</span>
            )}
          </Section>
        </Surface>

        <Surface elevated className="flex flex-col gap-4 p-5 lg:sticky lg:top-4" data-tour="agency-summary">
          <div className="flex flex-col gap-1">
            <span className={cn("text-featured-3 font-semibold", !form.name.trim() && "text-subtle")}>{form.name.trim() || "New agency"}</span>
            <span className="text-caption-1 text-faded">{form.csv && form.api ? "CSV and API" : form.api ? "API connection" : form.csv ? "CSV uploads" : "No connection yet"}</span>
          </div>
          <dl className="flex flex-col divide-y divide-border border-y border-border text-body-3">
            <Line label="Markets">
              <Tip content={joinNames(form.cityIds.map((c) => city(c).name))}>
                <span>{form.cityIds.length || <span className="text-subtle">None</span>}</span>
              </Tip>
            </Line>
            <Line label="Roles">{form.positionIds.length || <span className="text-subtle">None</span>}</Line>
            <Line label="Rates">
              {rows.length ? (
                <span>
                  {rows.length}
                  {above > 0 && <span className="text-warning-fg"> · {above} above market</span>}
                </span>
              ) : (
                <span className="text-subtle">None</span>
              )}
            </Line>
            <Line label="Insurance">{form.coiExpiresOn > todayISO() ? `To ${formatDateFull(form.coiExpiresOn)}` : <span className="text-warning-fg">Expired</span>}</Line>
            <Line label="Agreement">{form.msaSigned ? "Signed" : <span className="text-subtle">Not yet</span>}</Line>
            <Line label="Workers">{form.roster?.names.length ?? <span className="text-subtle">None yet</span>}</Line>
            <Line label="Buyers">{buyerIds.length || <span className="text-subtle">None</span>}</Line>
          </dl>
          <div className="flex flex-col gap-2">
            <Button onClick={submit} disabled={busy || missing.length > 0} data-tour="agency-submit">
              <Check /> Add agency
            </Button>
            {missing.length > 0 && <span className="text-center text-caption-1 text-subtle">Needs {missing[0]}</span>}
          </div>
        </Surface>
      </div>
    </>
  )
}

function RosterImport({ roster, sampleFile, onChange }: { roster?: { file: string; names: Name[] }; sampleFile: string; onChange: (roster?: { file: string; names: Name[] }) => void }) {
  const [error, setError] = useState<string>()
  const read = async (file?: File) => {
    if (!file) return
    const names = readRoster(await file.text())
    setError(names.length ? undefined : `No names found in ${file.name}. It needs a first and last name column.`)
    onChange(names.length ? { file: file.name, names } : undefined)
  }
  return roster ? (
    <div className="flex flex-col gap-1.5" data-tour="agency-roster">
      <span className="flex items-center gap-2 text-body-3">
        <FileSpreadsheet className="size-4 text-positive-fg" />
        <span className="font-semibold">{roster.file}</span>
        <span className="text-faded">· {plural(roster.names.length, "worker")}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onChange(undefined)}>
          Remove
        </Button>
      </span>
      <span className="text-caption-1 text-faded">
        {joinNames(roster.names.slice(0, 4).map((n) => `${n.firstName} ${n.lastName}`))}
        {roster.names.length > 4 ? ` and ${roster.names.length - 4} more` : ""}. Iris checks each one&apos;s documents as they arrive.
      </span>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2" data-tour="agency-roster">
      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-3 text-body-3 font-medium hover:bg-hover">
        <Upload className="size-4" /> Upload roster CSV
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
      </label>
      <Button
        variant="ghost"
        className="h-9"
        onClick={() => onChange({ file: sampleFile, names: SAMPLE_NAMES.map((n) => ({ firstName: n.split(" ")[0], lastName: n.split(" ").slice(1).join(" ") })) })}
      >
        Use a sample roster
      </Button>
      {error && <span className="text-caption-1 text-critical-fg">{error}</span>}
    </div>
  )
}

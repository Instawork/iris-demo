"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Building2, Check, FileCheck2, FileSpreadsheet, Paperclip, Upload } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/common/status-badge"
import { Chip, Field, Stat, Steps, Summary, inputClass } from "@/components/onboarding/steps"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useData } from "@/hooks/use-app"
import { addDaysISO, formatDateFull, todayISO } from "@/lib/dates"
import { billFrom, money, roundTo } from "@/lib/format"
import { BUYERS, CITIES, LOCATIONS, POSITIONS, PROGRAM, WORKSPACES, city, position } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import type { DemoData } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Adding an agency the way Compass contracts one: who to call, where and what it staffs, its insurance and agreement,
 * a rate card checked against what the other agencies charge, and its workers from the roster file it sends. Approved
 * buyers send it shifts right away.
 */

const STEPS = ["Agency", "Coverage", "Paperwork", "Rates", "Workers", "Review"]
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
  buyerIds: string[]
}

export function AgencyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const router = useRouter()
  const onboardAgency = useStore((s) => s.onboardAgency)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string>()
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
    buyerIds: [],
  }))
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])
  const short = form.shortName.trim() || form.name.trim().split(/\s+/)[0] || "The agency"

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
  const badRates = rows.filter((r) => !(r.pay >= 7.25) || !(r.markup >= 0) || r.markup > PROGRAM.maxMarkupPct)
  const buyers = BUYERS.filter((b) => LOCATIONS.some((l) => l.buyerId === b.id && form.cityIds.includes(l.cityId)))

  const ready = [
    !!form.name.trim() && !!form.contactName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim()) && (form.csv || form.api),
    form.cityIds.length > 0 && form.positionIds.length > 0,
    form.msaSigned && form.coiExpiresOn > todayISO(),
    rows.length > 0 && badRates.length === 0,
    true,
    true,
  ]

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setStep(0)
      setCreated(undefined)
    }
  }

  const goTo = (next: number) => {
    if (next === 4 && step < 4 && !form.buyerIds.length) set({ buyerIds: buyers.map((b) => b.id) })
    setStep(next)
  }

  const submit = async () => {
    setBusy(true)
    const id = await onboardAgency({
      name: form.name.trim(),
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
      buyerIds: form.buyerIds.filter((b) => buyers.some((x) => x.id === b)),
      roster: form.roster?.names.length ?? 0,
      rosterNames: form.roster?.names,
    })
    setBusy(false)
    if (!id) return
    setCreated(id)
    toast.success(`${form.name.trim()} is on Iris`)
  }

  const openAsAgency = async () => {
    const ws = WORKSPACES.find((w) => w.supplierId === created)
    if (!ws) return
    await setWorkspace(ws.id)
    close(false)
    router.push("/")
  }

  const pros = created ? data.pros.filter((p) => p.supplierId === created) : []
  const held = pros.filter((p) => p.compliance.background?.status === "pending").length
  const categories = [...new Set(POSITIONS.map((p) => p.category))]

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-tour="agency-dialog" data-stage={created ? "done" : STEPS[step]}>
        <DialogHeader>
          <DialogTitle>{created ? `${form.name.trim()} is on Iris` : "Add an agency"}</DialogTitle>
          <DialogDescription>
            {created
              ? `${short} can sign in and take shifts from the buyers that approved it.`
              : "Everything Compass needs before an agency gets its first shift."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Rate card" value={`${rows.length} rates`} sub={`${joinNames(form.cityIds.map((c) => city(c).name))}, live today`} />
              <Stat label="Workers" value={String(pros.length)} sub={held ? `${held} held until their background check clears` : "All cleared to work"} />
              <Stat label="Approved for" value={String(form.buyerIds.length)} sub={form.buyerIds.length ? joinNames(form.buyerIds.map((b) => BUYERS.find((x) => x.id === b)!.name)) : "No buyers yet"} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)} data-tour="wizard-done">
                Done
              </Button>
              <Button onClick={openAsAgency}>
                <Building2 /> Open Iris as {short}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Steps steps={STEPS} current={step} onPick={goTo} />

            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal name">
                  <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Northwind Event Staffing" className={inputClass} autoFocus />
                </Field>
                <Field label="Short name" hint="How Iris shows it in lists and on shifts.">
                  <input value={form.shortName} onChange={(e) => set({ shortName: e.target.value })} placeholder={form.name.trim().split(/\s+/)[0] || "Northwind"} className={inputClass} />
                </Field>
                <Field label="Main contact">
                  <input value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Alex Rivera" className={inputClass} />
                </Field>
                <Field label="Contact email">
                  <input value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} placeholder="alex@northwindstaff.com" type="email" className={inputClass} />
                </Field>
                <Field label="Sends workers and hours by" hint="Pick one or both." className="sm:col-span-2">
                  <div className="flex gap-2">
                    <Chip on={form.csv} onClick={() => set({ csv: !form.csv })}>
                      CSV uploads
                    </Chip>
                    <Chip on={form.api} onClick={() => set({ api: !form.api })}>
                      API connection
                    </Chip>
                  </div>
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">Markets</span>
                  <div className="flex flex-wrap gap-2">
                    {CITIES.map((c) => (
                      <Chip key={c.id} on={form.cityIds.includes(c.id)} onClick={() => set({ cityIds: toggle(form.cityIds, c.id) })}>
                        {c.name}, {c.state}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">Roles it staffs</span>
                  {categories.map((c) => (
                    <div key={c} className="flex flex-wrap items-center gap-2">
                      <span className="w-28 text-caption-1 text-subtle">{c}</span>
                      {POSITIONS.filter((p) => p.category === c).map((p) => (
                        <Chip key={p.id} on={form.positionIds.includes(p.id)} onClick={() => set({ positionIds: toggle(form.positionIds, p.id) })}>
                          {p.name}
                        </Chip>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Certificate of insurance expires" hint="Iris stops sending it shifts the day this lapses.">
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
                <label className="flex items-start gap-3 rounded-xl border border-border p-4">
                  <Checkbox checked={form.msaSigned} onCheckedChange={(v) => set({ msaSigned: v === true })} className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-body-3 font-semibold">Master services agreement signed</span>

                  </span>
                </label>
                <div className="grid gap-3 rounded-xl border border-border bg-page-faded p-4 sm:grid-cols-3">
                  <Term label="Payment terms" value={`Net ${PROGRAM.paymentTermsDays}, by ACH through Iris`} />
                  <Term label="Markup cap" value={`${PROGRAM.maxMarkupPct}% over the worker's pay`} />
                  <Term label="Compliance" value="Background check, I-9 and Compass orientation for every worker" />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-3">
                <p className="text-body-3 text-faded">Rates start at what agencies here already pay.</p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[620px] text-left text-body-3">
                    <thead>
                      <tr className="border-b border-border bg-page-faded text-caption-1 text-faded">
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">Pay rate</th>
                        <th className="px-3 py-2 font-medium">Markup</th>
                        <th className="px-3 py-2 text-right font-medium">Bill rate</th>
                        <th className="px-3 py-2 text-right font-medium">Against the market</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-b border-border/70 last:border-0">
                          <td className="px-3 py-2">
                            <span className="flex flex-col">
                              <span className="font-medium">{position(r.positionId).name}</span>
                              <span className="text-caption-1 text-faded">{city(r.cityId).name}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2">
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
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-1">
                              <input
                                value={r.entry.markup}
                                onChange={(e) => set({ rates: { ...form.rates, [r.key]: { ...r.entry, markup: e.target.value.replace(/[^\d.]/g, "") } } })}
                                aria-label={`${position(r.positionId).name} markup in ${city(r.cityId).name}`}
                                className={cn(inputClass, "h-8 w-16 tabular", r.markup > PROGRAM.maxMarkupPct && "border-critical")}
                              />
                              <span className="text-faded">%</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular">{r.bill ? money(r.bill) : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            {r.markup > PROGRAM.maxMarkupPct ? (
                              <StatusBadge tone="critical" size="sm">
                                Over the {PROGRAM.maxMarkupPct}% cap
                              </StatusBadge>
                            ) : r.over === undefined ? (
                              <span className="text-caption-1 text-subtle">First agency here</span>
                            ) : r.over > 0.1 ? (
                              <StatusBadge tone="warning" size="sm">
                                {Math.round(r.over * 100)}% above {money(r.market!.bill)}
                              </StatusBadge>
                            ) : r.over <= 0 ? (
                              <StatusBadge tone="positive" size="sm">
                                At or under {money(r.market!.bill)}
                              </StatusBadge>
                            ) : (
                              <span className="text-caption-1 text-faded tabular">
                                +{Math.round(r.over * 100)}% on {money(r.market!.bill)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="flex flex-col gap-4">
                <RosterImport
                  roster={form.roster}
                  sampleFile={`${(form.shortName.trim() || form.name.trim().split(/\s+/)[0] || "agency").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-roster.csv`}
                  onChange={(roster) => set({ roster })}
                />
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">Buyers that can send it shifts</span>
                  {buyers.length ? (
                    buyers.map((b) => {
                      const units = LOCATIONS.filter((l) => l.buyerId === b.id && form.cityIds.includes(l.cityId)).length
                      return (
                        <label key={b.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                          <Checkbox checked={form.buyerIds.includes(b.id)} onCheckedChange={() => set({ buyerIds: toggle(form.buyerIds, b.id) })} />
                          <span className="flex flex-col">
                            <span className="text-body-3 font-semibold">{b.name}</span>
                            <span className="text-caption-1 text-faded">
                              {units} {units === 1 ? "unit" : "units"} in its markets
                            </span>
                          </span>
                        </label>
                      )
                    })
                  ) : (
                    <span className="text-body-3 text-faded">No buyer has a unit in these markets yet.</span>
                  )}
                </div>
              </div>
            )}

            {step === 5 && (
              <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-border p-4 sm:grid-cols-2">
                <Summary label="Agency">
                  {form.name.trim()}
                  {form.shortName.trim() ? ` (${form.shortName.trim()})` : ""}
                </Summary>
                <Summary label="Contact">
                  {form.contactName.trim()} · {form.contactEmail.trim()}
                </Summary>
                <Summary label="Markets">{joinNames(form.cityIds.map((c) => city(c).name))}</Summary>
                <Summary label="Roles">{joinNames(form.positionIds.map((id) => position(id).name))}</Summary>
                <Summary label="Insurance">
                  Valid to {formatDateFull(form.coiExpiresOn)}
                  {form.coiFile ? ` · ${form.coiFile}` : ""}
                </Summary>
                <Summary label="Rate card">
                  {rows.length} rates, {rows.filter((r) => r.over !== undefined && r.over > 0.1).length} more than 10% above the market
                </Summary>
                <Summary label="Workers">{form.roster ? `${form.roster.names.length} from ${form.roster.file}` : "None yet"}</Summary>
                <Summary label="Approved for">{form.buyerIds.length ? joinNames(form.buyerIds.map((b) => BUYERS.find((x) => x.id === b)!.name)) : "No buyers yet"}</Summary>
              </dl>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => (step ? setStep(step - 1) : close(false))}>
                {step ? (
                  <>
                    <ArrowLeft /> Back
                  </>
                ) : (
                  "Cancel"
                )}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => goTo(step + 1)} disabled={!ready[step]} data-tour="wizard-next">
                  Next <ArrowRight />
                </Button>
              ) : (
                <Button onClick={submit} disabled={busy || !ready.every(Boolean)} data-tour="wizard-submit">
                  <Check /> Add agency
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption-1 text-faded">{label}</span>
      <span className="text-body-3 font-medium">{value}</span>
    </div>
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
  return (
    <div className="flex flex-col gap-2" data-tour="agency-roster">
      <span className="text-caption-1 font-medium text-faded">Their workers</span>
      {roster ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <span className="flex items-center gap-2 text-body-3">
            <FileSpreadsheet className="size-4 text-positive-fg" />
            <span className="font-semibold">{roster.file}</span>
            <span className="text-faded">· {roster.names.length} workers</span>
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
        <div className="flex flex-wrap items-center gap-2">
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
      )}
    </div>
  )
}

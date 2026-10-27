"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, CalendarPlus, Check, MapPin, ShieldCheck, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Chip, Field, Stat, Steps, Summary, inputClass } from "@/components/onboarding/steps"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useData, useWorkspace } from "@/hooks/use-app"
import { canWork, itemState } from "@/lib/compliance"
import { todayISO } from "@/lib/dates"
import { moneyWhole } from "@/lib/format"
import { BUYERS, POSITIONS, SUPPLIERS, WORKSPACES, buyer, marketForZip, policyFor, requirementLabel, requirementsFor } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import type { Pro, RequirementId } from "@/lib/types"

/**
 * Adding a unit: the buyer it belongs to, where it is, what every Pro working there needs, and what it orders. The
 * market comes from the ZIP code, so Iris shows which agencies and how many Pros can staff it before it's saved.
 */

const KINDS = ["Stadium", "Arena", "Ballpark", "Convention center", "Campus dining", "Corporate dining", "Hospital", "Senior living"]

const VENUE_ROLES = ["bartender", "barback", "concessions", "suite", "cashier", "porter"]
const ROLES_FOR: Record<string, string[]> = {
  Stadium: VENUE_ROLES,
  Arena: VENUE_ROLES,
  Ballpark: VENUE_ROLES,
  "Convention center": ["server", "bartender", "porter", "linecook", "dishwasher"],
}
const KITCHEN_ROLES = ["linecook", "prepcook", "dishwasher", "cashier"]

const RATINGS = [
  { value: "0", label: "Any rating" },
  { value: "4", label: "4.0 or higher" },
  { value: "4.5", label: "4.5 or higher" },
  { value: "4.8", label: "4.8 or higher" },
]

const STEPS = ["Unit", "Location", "Requirements", "Ordering", "Review"]

const BLOCKING = ["missing", "pending", "expired"]

interface Form {
  buyerId: string
  name: string
  kind: string
  costCenter: string
  address: string
  zip: string
  positionIds: string[]
  requires: RequirementId[]
  minRating: number
  weeklyBudget: string
  approverIds: string[]
}

export function UnitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const onboardUnit = useStore((s) => s.onboardUnit)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const buyers = ws.kind === "buyer" ? BUYERS.filter((b) => b.id === ws.buyerId) : BUYERS
  const approversOf = (buyerId: string) => WORKSPACES.filter((w) => w.kind === "buyer" && w.buyerId === buyerId)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string>()
  const [form, setForm] = useState<Form>(() => ({
    buyerId: buyers[0].id,
    name: "",
    kind: "Stadium",
    costCenter: "",
    address: "",
    zip: "",
    positionIds: ROLES_FOR.Stadium,
    requires: [],
    minRating: 0,
    weeklyBudget: "",
    approverIds: approversOf(buyers[0].id).filter((w) => w.approves?.length).map((w) => w.id),
  }))
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const today = todayISO()

  const market = /^\d{5}$/.test(form.zip) ? marketForZip(form.zip) : undefined
  const agencies = market ? SUPPLIERS.filter((s) => data.rateCards.some((c) => c.supplierId === s.id && c.cityId === market.id && c.status === "active")) : []
  const order = (data.approvals[form.buyerId] ?? []).filter((id) => agencies.some((a) => a.id === id) && data.rateCards.some((c) => c.supplierId === id && c.cityId === market?.id && form.positionIds.includes(c.positionId) && c.status === "active"))
  const documents = [...new Set([...requirementsFor(form.positionIds), ...form.requires])]

  const qualifies = (p: Pro) =>
    (!form.minRating || p.rating >= form.minRating) &&
    form.positionIds.some((r) => canWork(p, r, today).ok) &&
    form.requires.every((id) => !BLOCKING.includes(itemState(p.compliance[id], today)))
  const pool = useMemo(() => (market ? data.pros.filter((p) => p.cityId === market.id && p.status === "active" && p.positionIds.some((r) => form.positionIds.includes(r))) : []), [data.pros, market, form.positionIds])
  const qualified = pool.filter(qualifies).length

  const ready = [
    !!form.name.trim() && !!form.costCenter.trim(),
    !!form.address.trim() && !!market,
    true,
    form.positionIds.length > 0,
    true,
  ]

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setStep(0)
      setCreated(undefined)
    }
  }

  const submit = async () => {
    setBusy(true)
    const id = await onboardUnit({
      buyerId: form.buyerId,
      name: form.name.trim(),
      kind: form.kind,
      address: form.address.trim(),
      zip: form.zip,
      costCenter: form.costCenter.trim(),
      positionIds: form.positionIds,
      requires: form.requires,
      minRating: form.minRating || undefined,
      weeklyBudget: Number(form.weeklyBudget) || undefined,
      approverIds: form.approverIds,
    })
    setBusy(false)
    if (!id) return
    setCreated(id)
    toast.success(`${form.name.trim()} is live on Iris`)
  }

  const bookAsBuyer = async () => {
    const booker = approversOf(form.buyerId).find((w) => !w.approves?.length) ?? approversOf(form.buyerId)[0]
    if (!created || !booker) return
    if (booker.id !== ws.id) await setWorkspace(booker.id)
    close(false)
    router.push(`/shifts/new?location=${created}`)
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])
  const categories = [...new Set(POSITIONS.map((p) => p.category))]
  const booker = approversOf(form.buyerId).find((w) => !w.approves?.length)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" data-tour="unit-dialog" data-stage={created ? "done" : STEPS[step]}>
        <DialogHeader>
          <DialogTitle>{created ? `${form.name.trim()} is live` : "Add a unit"}</DialogTitle>
          <DialogDescription>
            {created ? "It can book shifts now. Every order there goes to the buyer's pick for the role first, then the other agencies by rate." : "A unit is one location with its own cost center: a venue, a campus, a hospital."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Agencies that staff it" value={String(order.length)} sub={joinNames(order.map((id) => SUPPLIERS.find((s) => s.id === id)?.shortName ?? id))} />
              <Stat label="Pros who qualify today" value={String(qualified)} sub={`of ${pool.length} in ${market?.name}`} />
              <Stat label="Weekly budget" value={Number(form.weeklyBudget) ? moneyWhole(Number(form.weeklyBudget)) : "None"} sub={Number(form.weeklyBudget) ? "Orders over it need an approver" : "Orders go straight out"} />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)} data-tour="wizard-done">
                Done
              </Button>
              {booker && (
                <Button onClick={bookAsBuyer}>
                  <CalendarPlus /> Book its first shift{booker.id === ws.id ? "" : ` as ${booker.user.name}`}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Steps steps={STEPS} current={step} onPick={setStep} />

            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Buyer">
                  <Select value={form.buyerId} onValueChange={(v) => set({ buyerId: v, approverIds: approversOf(v).filter((w) => w.approves?.length).map((w) => w.id) })} disabled={buyers.length === 1}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {buyers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} <span className="text-faded">· {b.sector}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Type">
                  <Select value={form.kind} onValueChange={(v) => set({ kind: v, positionIds: ROLES_FOR[v] ?? KITCHEN_ROLES })}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Unit name">
                  <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Soldier Field" className={inputClass} autoFocus />
                </Field>
                <Field label="Cost center" hint="The unit number every invoice line for it is charged to.">
                  <input value={form.costCenter} onChange={(e) => set({ costCenter: e.target.value.toUpperCase() })} placeholder="LEV-4450" className={inputClass} />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <Field label="Street address">
                    <input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="1410 Special Olympics Dr, Chicago, IL" className={inputClass} autoFocus />
                  </Field>
                  <Field label="ZIP code">
                    <input value={form.zip} onChange={(e) => set({ zip: e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="60605" inputMode="numeric" className={inputClass} />
                  </Field>
                </div>
                {form.zip.length === 5 && (
                  <div className={`flex items-start gap-3 rounded-xl border p-4 ${market ? "border-border bg-page-faded" : "border-warning-border bg-warning-faded"}`}>
                    <MapPin className="mt-0.5 size-4 shrink-0" />
                    {market ? (
                      <div className="flex min-w-0 flex-col gap-2">
                        <span className="text-body-3 font-semibold">
                          {market.name}, {market.state} market
                        </span>
                        <span className="text-caption-1 text-faded">
                          {agencies.length} {agencies.length === 1 ? "agency has" : "agencies have"} rates here. Shifts go out on {market.tz === "ET" ? "Eastern" : "Central"} time.
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {agencies.map((s) => (
                            <span key={s.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-caption-1 font-medium">
                              <SupplierLogo supplierId={s.id} size="sm" /> {s.shortName}
                            </span>
                          ))}
                        </span>
                      </div>
                    ) : (
                      <span className="text-body-3">No agency on Iris covers that ZIP code yet. Add an agency for that market first.</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">What Iris checks before every shift here</span>
                  <span className="flex flex-wrap gap-1.5">
                    {documents.map((id) => (
                      <StatusBadge key={id} tone={form.requires.includes(id) ? "primary" : "positive"} size="sm">
                        <ShieldCheck className="size-3" /> {requirementLabel(id)}
                      </StatusBadge>
                    ))}
                    {form.minRating > 0 && (
                      <StatusBadge tone="primary" size="sm">
                        <ShieldCheck className="size-3" /> Rated {form.minRating.toFixed(1)} or higher
                      </StatusBadge>
                    )}
                  </span>
                  <span className="text-caption-1 text-subtle">Background check, I-9 and Compass orientation apply everywhere. Food and bar roles add their certificates.</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">This unit also requires</span>
                  <div className="flex flex-wrap gap-2">
                    <Chip on={form.requires.includes("foodHandler")} onClick={() => set({ requires: toggle(form.requires, "foodHandler" as RequirementId) })}>
                      Food handler card for every role
                    </Chip>
                    <Chip on={form.requires.includes("alcohol")} onClick={() => set({ requires: toggle(form.requires, "alcohol" as RequirementId) })}>
                      Alcohol server cert for every role
                    </Chip>
                  </div>
                </div>
                <Field label="Minimum Pro rating" className="max-w-56">
                  <Select value={String(form.minRating)} onValueChange={(v) => set({ minRating: Number(v) })}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RATINGS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <QualifyLine qualified={qualified} pool={pool.length} city={market?.name} />
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">Roles this unit orders</span>
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Weekly budget" hint="Orders that take a week over it wait for an approver.">
                    <input value={form.weeklyBudget} onChange={(e) => set({ weeklyBudget: e.target.value.replace(/[^\d]/g, "") })} placeholder="No budget" inputMode="numeric" className={inputClass} />
                  </Field>
                  <Field label="Approves orders over budget">
                    <Select value={form.approverIds[0] ?? "none"} onValueChange={(v) => set({ approverIds: v === "none" ? [] : [v] })}>
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nobody</SelectItem>
                        {approversOf(form.buyerId).map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.user.name} <span className="text-faded">· {w.user.title}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-border bg-page-faded p-4">
                  <Users className="mt-0.5 size-4 shrink-0" />
                  <span className="text-body-3">
                    {order.length
                      ? `Orders go to ${joinNames(order.map((id) => SUPPLIERS.find((s) => s.id === id)!.shortName))}, best offer first, then by rate, ${policyFor(form.buyerId).tierGapHours} hours apart.`
                      : `None of ${buyer(form.buyerId).name}'s approved agencies has rates for these roles here yet.`}
                  </span>
                </div>
              </div>
            )}

            {step === 4 && (
              <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-border p-4 sm:grid-cols-2">
                <Summary label="Unit">
                  {form.name.trim()} · {form.kind}
                </Summary>
                <Summary label="Buyer and cost center">
                  {buyer(form.buyerId).name} · {form.costCenter.trim()}
                </Summary>
                <Summary label="Location">
                  {form.address.trim()}, {form.zip}
                  {market ? ` · ${market.name} market` : ""}
                </Summary>
                <Summary label="Roles">{joinNames(form.positionIds.map((id) => POSITIONS.find((p) => p.id === id)!.name))}</Summary>
                <Summary label="Every Pro needs">
                  {joinNames(documents.map(requirementLabel))}
                  {form.minRating ? `, rated ${form.minRating.toFixed(1)}+` : ""}
                </Summary>
                <Summary label="Budget">{Number(form.weeklyBudget) ? `${moneyWhole(Number(form.weeklyBudget))} a week` : "None"}</Summary>
                <Summary label="Staffed by">{order.length ? joinNames(order.map((id) => SUPPLIERS.find((s) => s.id === id)!.shortName)) : "No agency yet"}</Summary>
                <Summary label="Pros who qualify today">
                  {qualified} of {pool.length} in {market?.name}
                </Summary>
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
                <Button onClick={() => setStep(step + 1)} disabled={!ready[step]} data-tour="wizard-next">
                  Next <ArrowRight />
                </Button>
              ) : (
                <Button onClick={submit} disabled={busy || !ready.every(Boolean)} data-tour="wizard-submit">
                  <Check /> Add unit
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function QualifyLine({ qualified, pool, city }: { qualified: number; pool: number; city?: string }) {
  if (!city) return null
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-page-faded p-4">
      <Users className="mt-0.5 size-4 shrink-0" />
      <span className="text-body-3">
        <span className="font-semibold tabular">
          {qualified} of {pool}
        </span>{" "}
        Pros in {city} who do these roles could work here today. Pros missing anything stay off its shifts until it&apos;s current.
      </span>
    </div>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, CalendarPlus, Check, MapPin, Plus, ShieldCheck, Users, X } from "lucide-react"
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
import { BUYERS, POSITIONS, SUPPLIERS, WORKSPACES, buyer, departmentsFor, marketForZip, requirementLabel, requirementsFor } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { Department, Pro, RequirementId } from "@/lib/types"

/**
 * Adding a unit: the buyer it belongs to, where it is, the roles it orders and what workers need for them, and the
 * departments it charges to. The market comes from the ZIP code, so Iris shows which agencies and how many workers
 * can staff it before it's saved.
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

const STEPS = ["Unit", "Location", "Roles", "Departments", "Review"]

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
  departments: Department[]
  /** Set once the departments are edited, so changing the type or cost center stops replacing them. */
  ownDepartments: boolean
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
    departments: [],
    ownDepartments: false,
  }))
  const set = (patch: Partial<Form>) =>
    setForm((f) => {
      const next = { ...f, ...patch }
      return next.ownDepartments ? next : { ...next, departments: departmentsFor(next.kind, next.costCenter.trim() || "CC").filter((d) => !d.positionIds || d.positionIds.some((p) => next.positionIds.includes(p))) }
    })
  const editDepartment = (i: number, patch: Partial<Department>) => set({ ownDepartments: true, departments: form.departments.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  const today = todayISO()

  const market = /^\d{5}$/.test(form.zip) ? marketForZip(form.zip) : undefined
  const agencies = market ? SUPPLIERS.filter((s) => data.rateCards.some((c) => c.supplierId === s.id && c.cityId === market.id && c.status === "active")) : []
  const order = (data.approvals[form.buyerId] ?? []).filter((id) => agencies.some((a) => a.id === id) && data.rateCards.some((c) => c.supplierId === id && c.cityId === market?.id && form.positionIds.includes(c.positionId) && c.status === "active"))
  const documents = [...new Set([...requirementsFor(form.positionIds), ...form.requires])]

  const qualifies = (p: Pro) =>
    form.positionIds.some((r) => canWork(p, r, today).ok) &&
    form.requires.every((id) => !BLOCKING.includes(itemState(p.compliance[id], today)))
  const pool = useMemo(() => (market ? data.pros.filter((p) => p.cityId === market.id && p.status === "active" && p.positionIds.some((r) => form.positionIds.includes(r))) : []), [data.pros, market, form.positionIds])
  const qualified = pool.filter(qualifies).length

  const ready = [
    !!form.name.trim() && !!form.costCenter.trim(),
    !!form.address.trim() && !!market,
    form.positionIds.length > 0,
    form.departments.every((d) => d.name.trim() && d.costCenter.trim()),
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
      departments: form.departments.map((d) => ({ name: d.name.trim(), costCenter: d.costCenter.trim(), positionIds: d.positionIds })),
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
            {created ? "It can book shifts now." : "One location with its own cost center: a venue, a campus, a hospital."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Agencies that staff it" value={String(order.length)} sub={joinNames(order.map((id) => SUPPLIERS.find((s) => s.id === id)?.shortName ?? id))} />
              <Stat label="Workers who qualify today" value={String(qualified)} sub={`of ${pool.length} in ${market?.name}`} />
              <Stat label="Departments" value={String(form.departments.length)} sub={joinNames(form.departments.map((d) => d.name)) || "Billed to the unit"} />
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
                  <Select value={form.buyerId} onValueChange={(v) => set({ buyerId: v })} disabled={buyers.length === 1}>
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
                <Field label="Cost center">
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
                  <span className="text-caption-1 font-medium text-faded">Roles it orders</span>
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
                <div className="flex flex-col gap-2">
                  <span className="text-caption-1 font-medium text-faded">Checked before every shift</span>
                  <span className="flex flex-wrap gap-1.5">
                    {documents.map((id) => (
                      <StatusBadge key={id} tone={form.requires.includes(id) ? "primary" : "positive"} size="sm">
                        <ShieldCheck className="size-3" /> {requirementLabel(id)}
                      </StatusBadge>
                    ))}
                  </span>
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
                <QualifyLine qualified={qualified} pool={pool.length} city={market?.name} />
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-3" data-tour="unit-departments">
                <div className="grid grid-cols-[1fr_150px_minmax(0,1.2fr)_32px] items-center gap-x-3 gap-y-2">
                  <span className="text-caption-1 font-medium text-faded">Department</span>
                  <span className="text-caption-1 font-medium text-faded">Cost center</span>
                  <span className="text-caption-1 font-medium text-faded">Roles</span>
                  <span />
                  {form.departments.map((d, i) => (
                    <DepartmentRow
                      key={d.id}
                      department={d}
                      roles={form.positionIds}
                      onChange={(patch) => editDepartment(i, patch)}
                      onRemove={() => set({ ownDepartments: true, departments: form.departments.filter((_, j) => j !== i) })}
                    />
                  ))}
                </div>
                {!form.departments.length && <span className="text-body-3 text-faded">No departments. Everything is charged to {form.costCenter.trim() || "the unit"}.</span>}
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    set({
                      ownDepartments: true,
                      departments: [...form.departments, { id: `dept-${Date.now()}`, name: "", costCenter: `${form.costCenter.trim()}-${(form.departments.length + 1) * 10}` }],
                    })
                  }
                >
                  <Plus /> Add department
                </Button>
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
                <Summary label="Every worker needs">{joinNames(documents.map(requirementLabel))}</Summary>
                <Summary label="Departments">{form.departments.length ? form.departments.map((d) => `${d.name.trim()} (${d.costCenter.trim()})`).join(", ") : "None"}</Summary>
                <Summary label="Staffed by">{order.length ? joinNames(order.map((id) => SUPPLIERS.find((s) => s.id === id)!.shortName)) : "No agency yet"}</Summary>
                <Summary label="Workers who qualify today">
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
        workers in {city} who do these roles could work here today.
      </span>
    </div>
  )
}

function DepartmentRow({ department, roles, onChange, onRemove }: { department: Department; roles: string[]; onChange: (patch: Partial<Department>) => void; onRemove: () => void }) {
  const own = department.positionIds ?? []
  return (
    <>
      <input value={department.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Concessions" className={inputClass} aria-label="Department name" />
      <input value={department.costCenter} onChange={(e) => onChange({ costCenter: e.target.value.toUpperCase() })} placeholder="LEV-4450-10" className={inputClass} aria-label="Cost center" />
      <span className="flex flex-wrap gap-1">
        {roles.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={own.includes(id)}
            onClick={() => onChange({ positionIds: own.includes(id) ? own.filter((x) => x !== id) : [...own, id] })}
            className={cn(
              "h-6 rounded-md border px-1.5 text-caption-1 transition-colors",
              own.includes(id) ? "border-foreground/25 bg-foreground/[0.06] font-medium" : "border-transparent text-subtle hover:bg-hover hover:text-foreground",
            )}
          >
            {POSITIONS.find((p) => p.id === id)?.name}
          </button>
        ))}
      </span>
      <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${department.name || "department"}`}>
        <X />
      </Button>
    </>
  )
}

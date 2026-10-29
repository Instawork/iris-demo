"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Check, ChevronRight, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { Surface } from "@/components/common/surface"
import { Field, inputClass } from "@/components/onboarding/steps"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useData, useWorkspace } from "@/hooks/use-app"
import { canWork, itemState } from "@/lib/compliance"
import { todayISO } from "@/lib/dates"
import { plural } from "@/lib/format"
import { BUYERS, POSITIONS, SUPPLIERS, WORKSPACES, buyer, departmentsFor, marketForZip, requirementLabel, requirementsFor } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import type { Department, Pro, RequirementId } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Adding a unit, on one page: the buyer it belongs to, where it is, the roles it orders and the departments it charges
 * to. The summary beside the form fills in as you type: where the unit files in Compass, which agencies cover its
 * market and how many workers could work there today.
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

const EXTRA: { id: RequirementId; label: string }[] = [
  { id: "foodHandler", label: "Food handler card" },
  { id: "alcohol", label: "Alcohol server cert" },
]

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

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

export function NewUnitPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const fromSettings = useSearchParams().get("from") === "settings"
  const onboardUnit = useStore((s) => s.onboardUnit)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const buyers = ws.kind === "buyer" ? BUYERS.filter((b) => b.id === ws.buyerId) : BUYERS
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Form>(() => ({
    buyerId: buyers[0].id,
    name: "",
    kind: "Stadium",
    costCenter: "",
    address: "",
    zip: "",
    positionIds: ROLES_FOR.Stadium,
    requires: [],
    departments: departmentsFor("Stadium", ""),
    ownDepartments: false,
  }))
  const set = (patch: Partial<Form>) =>
    setForm((f) => {
      const next = { ...f, ...patch }
      return next.ownDepartments ? next : { ...next, departments: departmentsFor(next.kind, next.costCenter.trim()).filter((d) => !d.positionIds || d.positionIds.some((p) => next.positionIds.includes(p))) }
    })
  const editDepartment = (i: number, patch: Partial<Department>) => set({ ownDepartments: true, departments: form.departments.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  const today = todayISO()

  const b = buyer(form.buyerId)
  const market = /^\d{5}$/.test(form.zip) ? marketForZip(form.zip) : undefined
  const agencies = market ? SUPPLIERS.filter((s) => data.rateCards.some((c) => c.supplierId === s.id && c.cityId === market.id && c.status === "active")) : []
  const staffedBy = (data.approvals[form.buyerId] ?? []).filter((id) => data.rateCards.some((c) => c.supplierId === id && c.cityId === market?.id && form.positionIds.includes(c.positionId) && c.status === "active"))
  const checks = [...new Set([...requirementsFor(form.positionIds), ...form.requires])]

  const qualifies = (p: Pro) => form.positionIds.some((r) => canWork(p, r, today).ok) && form.requires.every((id) => !BLOCKING.includes(itemState(p.compliance[id], today)))
  const pool = useMemo(() => (market ? data.pros.filter((p) => p.cityId === market.id && p.status === "active" && p.positionIds.some((r) => form.positionIds.includes(r))) : []), [data.pros, market, form.positionIds])
  const qualified = pool.filter(qualifies).length

  const missing = [
    !form.name.trim() && "a name",
    !form.costCenter.trim() && "a cost center",
    !form.address.trim() && "an address",
    !market && "a ZIP code an agency covers",
    !form.positionIds.length && "a role",
  ].filter(Boolean) as string[]
  const incomplete = form.departments.some((d) => !d.name.trim() || !d.costCenter.trim())
  const ready = !missing.length && !incomplete

  const bookAsBuyer = async (id: string) => {
    const booker = WORKSPACES.find((w) => w.kind === "buyer" && w.buyerId === form.buyerId && !w.approves?.length)
    if (!booker) return
    if (booker.id !== useStore.getState().workspaceId) await setWorkspace(booker.id)
    router.push(`/shifts/new?location=${id}`)
  }

  const submit = async () => {
    setBusy(true)
    const name = form.name.trim()
    const id = await onboardUnit({
      buyerId: form.buyerId,
      name,
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
    toast.success(`${name} is live under ${b.name}`, { action: { label: "Book a shift", onClick: () => void bookAsBuyer(id) } })
    router.push(fromSettings ? "/settings/locations" : `/units?unit=${id}`)
  }

  const categories = [...new Set(POSITIONS.map((p) => p.category))]

  return (
    <>
      <PageHeader className="pt-4" title="Add a unit" />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" data-tour="unit-form">
        <Surface elevated className="flex flex-col divide-y divide-border">
          <Section title="Unit">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Buyer">
                <Select value={form.buyerId} onValueChange={(v) => set({ buyerId: v })} disabled={buyers.length === 1}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {buyers.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
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
              <Field label="Street address">
                <input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="1410 Special Olympics Dr, Chicago, IL" className={inputClass} />
              </Field>
              <Field
                label="ZIP code"
                hint={
                  form.zip.length === 5 &&
                  (market ? (
                    <Tip content={joinNames(agencies.map((s) => s.shortName))}>
                      <span className="text-faded" data-tour="unit-market">
                        {market.name}, {market.state} ({plural(agencies.length, "agency", "agencies")})
                      </span>
                    </Tip>
                  ) : (
                    <span className="text-warning-fg">No agency covers this ZIP yet</span>
                  ))
                }
              >
                <input value={form.zip} onChange={(e) => set({ zip: e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="60605" inputMode="numeric" className={inputClass} />
              </Field>
            </div>
          </Section>

          <Section title="Roles it orders">
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
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1 pb-1 text-caption-1 font-medium text-faded">
                Every role here also needs
                <InfoTip>On top of the background check, I-9, Compass orientation and each role&apos;s own certificates.</InfoTip>
              </span>
              <div className="grid gap-x-6 sm:grid-cols-3">
                {EXTRA.map((r) => (
                  <CheckRow key={r.id} on={form.requires.includes(r.id)} onClick={() => set({ requires: toggle(form.requires, r.id) })}>
                    {r.label}
                  </CheckRow>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Departments" info="Parts of the unit billed to their own cost center, like a stadium's bars and suites.">
            {form.departments.length > 0 && (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)_32px] items-center gap-x-3 gap-y-2">
                <span className="text-caption-1 font-medium text-faded">Department</span>
                <span className="text-caption-1 font-medium text-faded">Cost center</span>
                <span />
                {form.departments.map((d, i) => (
                  <DepartmentRow
                    key={d.id}
                    department={d}
                    onChange={(patch) => editDepartment(i, patch)}
                    onRemove={() => set({ ownDepartments: true, departments: form.departments.filter((_, j) => j !== i) })}
                  />
                ))}
              </div>
            )}
            {!form.departments.length && <span className="text-body-3 text-faded">None. Everything bills to {form.costCenter.trim() || "the unit"}.</span>}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                set({
                  ownDepartments: true,
                  departments: [...form.departments, { id: `dept-${Date.now()}`, name: "", costCenter: form.costCenter.trim() ? `${form.costCenter.trim()}-${(form.departments.length + 1) * 10}` : "" }],
                })
              }
            >
              <Plus /> Add department
            </Button>
          </Section>
        </Surface>

        <Surface elevated className="flex flex-col gap-4 p-5 lg:sticky lg:top-4" data-tour="unit-summary">
          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1 text-caption-1 text-faded">
              {[b.sector, b.brand, b.name].map((x, i) => (
                <span key={x} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3" />}
                  {x}
                </span>
              ))}
            </span>
            <span className={cn("text-featured-3 font-semibold", !form.name.trim() && "text-subtle")}>{form.name.trim() || "New unit"}</span>
            <span className="text-caption-1 text-faded">
              {form.kind}
              {form.costCenter.trim() && <> · <code className="font-mono">{form.costCenter.trim()}</code></>}
            </span>
          </div>
          <dl className="flex flex-col divide-y divide-border border-y border-border text-body-3">
            <Line label="Market">{market ? `${market.name}, ${market.state}` : <span className="text-subtle">From the ZIP</span>}</Line>
            <Line label="Staffed by">
              {staffedBy.length ? (
                <span className="flex -space-x-1">
                  {staffedBy.map((id) => (
                    <Tip key={id} content={SUPPLIERS.find((s) => s.id === id)?.shortName}>
                      <span className="inline-flex">
                        <SupplierLogo supplierId={id} size="sm" className="ring-2 ring-card" />
                      </span>
                    </Tip>
                  ))}
                </span>
              ) : (
                <span className="text-subtle">{market ? "No agency yet" : "From the ZIP"}</span>
              )}
            </Line>
            <Line label="Roles">{form.positionIds.length || <span className="text-subtle">None</span>}</Line>
            <Line label="Cost centers">{1 + form.departments.length}</Line>
            <Line label="Checks per worker">
              <Tip content={joinNames(checks.map(requirementLabel))}>
                <span>{checks.length}</span>
              </Tip>
            </Line>
            <Line label="Could work here today">{market ? `${qualified} of ${pool.length}` : <span className="text-subtle">From the ZIP</span>}</Line>
          </dl>
          <div className="flex flex-col gap-2">
            <Button onClick={submit} disabled={busy || !ready} data-tour="unit-submit">
              <Check /> Add unit
            </Button>
            {!ready && <span className="text-center text-caption-1 text-subtle">{missing.length ? `Needs ${missing[0]}` : "Name each department and its cost center"}</span>}
          </div>
        </Surface>
      </div>
    </>
  )
}

function Section({ title, info, children }: { title: string; info?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 p-6">
      <h2 className="flex items-center gap-1.5 text-body-2 font-semibold">
        {title}
        {info && <InfoTip>{info}</InfoTip>}
      </h2>
      {children}
    </section>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-faded">{label}</dt>
      <dd className="font-medium tabular">{children}</dd>
    </div>
  )
}

/** A checkbox row, as a button so it reads and toggles the same way everywhere. */
function CheckRow({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="-mx-1.5 flex h-8 items-center gap-2 rounded-md px-1.5 text-left text-body-3 transition-colors hover:bg-hover">
      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border-strong")}>
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      {children}
    </button>
  )
}

function DepartmentRow({ department, onChange, onRemove }: { department: Department; onChange: (patch: Partial<Department>) => void; onRemove: () => void }) {
  return (
    <>
      <input value={department.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Concessions" className={inputClass} aria-label="Department name" />
      <input value={department.costCenter} onChange={(e) => onChange({ costCenter: e.target.value.toUpperCase() })} placeholder="LEV-4450-10" className={cn(inputClass, "font-mono")} aria-label="Cost center" />
      <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${department.name || "department"}`}>
        <X />
      </Button>
    </>
  )
}

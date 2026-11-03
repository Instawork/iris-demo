"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Clock,
  Heart,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react"
import { motion } from "motion/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useData, useWorkspace } from "@/hooks/use-app"
import { canWork } from "@/lib/compliance"
import { addDaysISO, formatClock, formatDateShort, formatDay, formatTimestamp, paidHours, parseDate, toISODate, todayISO } from "@/lib/dates"
import { previewOrder, type OrderPreview } from "@/lib/domain/order"
import { money, pct, round2 } from "@/lib/format"
import { formatTimeToFill, metricsFor, type SupplierMetrics } from "@/lib/metrics"
import { POSITIONS, PROGRAM, city, departmentOf, location, locationsFor, position, requirementLabel, requirementsFor } from "@/lib/reference"
import { joinNames, notifiedSuppliers, pickedOffer, useStore } from "@/lib/store"
import type { RateCard, Supplier } from "@/lib/types"
import { cn } from "@/lib/utils"

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`)
const STEPS = ["Schedule", "Review"] as const

interface Draft {
  locationId: string
  positionId: string
  dates: string[]
  start: string
  end: string
  breakMins: number
  headcount: number
  name: string
  eventName: string
  instructions: string
  tips: boolean
  dispatch: Dispatch
  onlyAgencyId: string
  /** Who sees this order first, when not the buyer's pick for the role. */
  firstAgencyId: string
  /** Workers asked for by name, all from the one agency. */
  proIds: string[]
  /** Empty while it follows the role's department. */
  departmentId: string
}

type Dispatch = "release" | "agency"

interface Quote {
  supplier: Supplier
  card: RateCard
  metrics: SupplierMetrics
  total: number
}

export function BookingWizard() {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const params = useSearchParams()
  const bookShifts = useStore((s) => s.bookShifts)
  const locations = locationsFor(ws.buyerId)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  const [draft, setDraft] = useState<Draft>(() => {
    const from = params.get("from")
    const src = from ? data.groups.find((g) => g.id === from) : undefined
    const asked = locations.find((l) => l.id === params.get("location"))
    const loc = src ? src.locationId : (asked ?? locations[0])?.id
    const usual = ws.buyerId === "chartwells-south" ? "linecook" : "bartender"
    const roles = asked?.positionIds
    const posId = src?.positionId ?? (roles?.length && !roles.includes(usual) ? roles[0] : usual)
    return {
      locationId: loc ?? "",
      positionId: posId,
      dates: [addDaysISO(todayISO(), src ? 7 : 5)],
      start: src?.start ?? "16:30",
      end: src?.end ?? "23:30",
      breakMins: src?.breakMins ?? 30,
      headcount: src?.slots.length ?? 8,
      name: src?.name ?? "",
      eventName: src?.eventName ?? "",
      instructions: src?.instructions ?? position(posId).duties,
      tips: src ? src.badges.includes("TIPS") : position(posId).alcohol,
      dispatch: "release",
      onlyAgencyId: "",
      firstAgencyId: "",
      proIds: [],
      departmentId: src?.departmentId ?? "",
    }
  })
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const loc = location(draft.locationId)
  const pos = position(draft.positionId)
  const hrs = paidHours(draft.start, draft.end, draft.breakMins)
  const spots = draft.headcount * draft.dates.length
  const department = departmentOf(loc.id, draft.departmentId || undefined, draft.positionId)

  const quotes = useMemo<Quote[]>(
    () =>
      notifiedSuppliers(data, ws.buyerId!, loc.cityId, draft.positionId, draft.firstAgencyId || undefined).map((n) => ({
        ...n,
        metrics: metricsFor(data, n.supplier.id, ws.buyerId),
        total: round2(n.card.billRate * hrs * spots),
      })),
    [data, ws.buyerId, loc.cityId, draft.positionId, draft.firstAgencyId, hrs, spots],
  )
  const firstAgencyId = draft.dispatch !== "agency" && draft.firstAgencyId && quotes[0]?.supplier.id === draft.firstAgencyId ? draft.firstAgencyId : undefined
  const onlyAgencyId = draft.dispatch === "agency" && draft.onlyAgencyId ? draft.onlyAgencyId : undefined
  const preview = useMemo(
    () =>
      previewOrder(data, {
        locationId: draft.locationId,
        positionId: draft.positionId,
        dates: draft.dates,
        start: draft.start,
        end: draft.end,
        breakMins: draft.breakMins,
        headcount: draft.headcount,
        onlyAgencyId,
        firstAgencyId,
      }),
    [data, draft.locationId, draft.positionId, draft.dates, draft.start, draft.end, draft.breakMins, draft.headcount, onlyAgencyId, firstAgencyId],
  )
  const priced = (onlyAgencyId && quotes.filter((q) => q.supplier.id === onlyAgencyId)) || quotes
  const minTotal = priced.length ? Math.min(...priced.map((q) => q.total)) : 0
  const maxTotal = priced.length ? Math.max(...priced.map((q) => q.total)) : 0

  const scheduleErrors = [
    !draft.locationId && "Pick a work location",
    !draft.dates.length && "Pick at least one date",
    draft.start === draft.end && "Start and end time can't match",
    hrs <= 0 && "Shift needs paid hours",
    draft.dates.some((d) => d < todayISO()) && "Dates must be today or later",
  ].filter(Boolean) as string[]

  const go = (next: number) => {
    setDir(next > step ? 1 : -1)
    setStep(next)
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" })
  }

  const [requestKey] = useState(() => crypto.randomUUID())

  const submit = async () => {
    if (!quotes.length || submitting) return
    setSubmitting(true)
    const ids = await bookShifts(
      {
        locationId: draft.locationId,
        positionId: draft.positionId,
        dates: [...draft.dates].sort(),
        start: draft.start,
        end: draft.end,
        breakMins: draft.breakMins,
        headcount: draft.headcount,
        name: draft.name,
        eventName: draft.eventName,
        instructions: draft.instructions,
        attire: pos.attire,
        tips: draft.tips,
        ...(onlyAgencyId ? { onlyAgencyId } : {}),
        ...(firstAgencyId ? { firstAgencyId } : {}),
        ...(onlyAgencyId && draft.proIds.length ? { requestedProIds: draft.proIds } : {}),
        ...(department ? { departmentId: department.id } : {}),
      },
      requestKey,
    )
    if (!ids.length) {
      setSubmitting(false)
      return
    }
    const created = useStore.getState().data.groups.find((g) => g.id === ids[0])
    if (created?.approval?.status === "pending") {
      toast.success(`Sent ${spots} ${pos.name} spot${spots === 1 ? "" : "s"} for approval`, {
        description: `${joinNames(preview?.approvers.map((a) => a.user.name) ?? [])} approves it, then it goes to ${(draft.dispatch === "agency" ? quotes.find((q) => q.supplier.id === draft.onlyAgencyId) : undefined)?.supplier.shortName ?? quotes[0].supplier.shortName}.`,
      })
    } else if (draft.dispatch !== "release" && created) {
      const booked = created.slots.filter((x) => x.proId).length
      const only = draft.dispatch === "agency" ? quotes.find((q) => q.supplier.id === draft.onlyAgencyId)?.supplier.shortName : undefined
      toast.success(`Posted ${spots} ${pos.name} spot${spots === 1 ? "" : "s"}`, {
        description: booked ? `Only ${only} sees it. Iris booked ${booked} of the workers you asked for.` : `Only ${only} sees it.`,
      })
    } else {
      toast.success(`Posted ${spots} ${pos.name} spot${spots === 1 ? "" : "s"}`, {
        description:
          created && !created.supplierIds.length && created.supplierReleases?.[0]
            ? `${quotes[0].supplier.shortName} sees it ${formatTimestamp(created.supplierReleases[0].releasedAt)}, ${preview?.policy.releaseLeadHours} hours before the shift.`
            : quotes.length === 1
              ? `Sent to ${quotes[0].supplier.shortName}.`
              : `Sent to ${quotes[0].supplier.shortName} first. ${joinNames(quotes.slice(1).map((q) => q.supplier.shortName))} follow every ${preview?.policy.tierGapHours ?? PROGRAM.cascadeHoursBefore} hours if spots remain.`,
      })
    }
    router.push(ids.length === 1 ? `/shifts/${ids[0]}` : "/shifts")
  }

  return (
    <div className="flex flex-col gap-6 pt-4">
      <h1 className="flex items-center gap-2 text-featured-1 font-semibold">
        New shift
        <InfoTip className="size-[18px] [&>svg]:size-4">Describe the shift once. Your agencies fill it.</InfoTip>
      </h1>

      <StepBar step={step} />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="relative min-w-0 lg:col-span-2">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: dir * 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-4"
          >
            {step === 0 && <ScheduleStep draft={draft} set={set} setDraft={setDraft} locations={locations} hrs={hrs} />}
            {step === 1 && <ReviewStep draft={draft} set={set} setDraft={setDraft} quotes={quotes} spots={spots} preview={preview} picked={pickedOffer(data, ws.buyerId!, loc.cityId, draft.positionId)} />}
          </motion.div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="ghost" className="h-10 gap-1.5 rounded-lg" onClick={() => (step === 0 ? router.back() : go(step - 1))}>
              <ArrowLeft className="size-4" /> {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step === 0 ? (
              <Tip content={scheduleErrors.length ? scheduleErrors.join(" · ") : undefined}>
                <span>
                  <Button className="h-10 gap-1.5 rounded-lg px-5 font-semibold" disabled={scheduleErrors.length > 0} onClick={() => go(1)} data-tour="booking-review">
                    Review <ArrowRight className="size-4" />
                  </Button>
                </span>
              </Tip>
            ) : (
              <Button className="h-11 gap-2 rounded-lg px-6 text-body-2 font-semibold shadow-raised" disabled={!quotes.length || submitting} onClick={submit} data-tour="booking-post">
                <BadgeCheck className="size-5" /> {preview?.needsApproval ? "Send for approval" : `Post ${spots} spot${spots === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-4">
          <Surface elevated className="overflow-hidden">
            <div className="border-b border-border bg-page-faded px-5 py-4">
              <p className="text-caption-1 font-medium text-faded">Your shift</p>
              <p className="text-featured-3 font-bold">{pos.name}</p>
              <p className="text-body-3 text-faded">{loc.name}</p>
            </div>
            <dl className="flex flex-col gap-3 px-5 py-4 text-body-3">
              <SummaryRow icon={CalendarDays} label="Dates">
                {draft.dates.length ? [...draft.dates].sort().map((d) => formatDateShort(d)).join(", ") : "—"}
              </SummaryRow>
              <SummaryRow icon={Clock} label="Time">
                {formatClock(draft.start)} - {formatClock(draft.end)} · {hrs} paid hrs
              </SummaryRow>
              <SummaryRow icon={Users} label="Workers">
                {draft.headcount} per date · {spots} total
              </SummaryRow>
              <SummaryRow icon={MapPin} label={department ? department.name : "Cost center"}>
                <code className="font-mono">{department?.costCenter || loc.costCenter}</code>
              </SummaryRow>
            </dl>
            <div className="flex flex-col gap-1 border-t border-border px-5 py-4">
              <span className="flex items-center gap-1 text-caption-1 text-faded">
                Estimated cost <InfoTip>{minTotal === maxTotal ? "Paid hours at the agency's bill rate." : "Each worker is billed at their agency's rate, so the total lands in this range."}</InfoTip>
              </span>
              <span className="text-featured-3 font-bold tabular">
                {quotes.length ? (minTotal === maxTotal ? money(minTotal) : `${money(minTotal)} – ${money(maxTotal)}`) : "No agencies"}
              </span>
              <span className="text-caption-1 text-faded">
                {!quotes.length
                  ? "Approve an agency for this role first"
                  : draft.dispatch === "agency" && draft.onlyAgencyId
                    ? `Only ${quotes.find((q) => q.supplier.id === draft.onlyAgencyId)?.supplier.shortName ?? "one agency"}${draft.proIds.length ? `, ${draft.proIds.length} asked for by name` : ""}`
                    : `${quotes.length} agenc${quotes.length === 1 ? "y" : "ies"} in release order`}
              </span>
            </div>
          </Surface>
        </aside>
      </div>
    </div>
  )
}

function SummaryRow({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
      <div className="flex min-w-0 flex-col">
        <dt className="text-caption-1 text-faded">{label}</dt>
        <dd className="font-medium">{children}</dd>
      </div>
    </div>
  )
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-tint">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-primary" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.25 }} />
      </div>
      <ol className="grid grid-cols-3 text-body-3 font-medium">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", i === 1 && "justify-center", i === 2 && "justify-end", i <= step ? "text-primary" : "text-subtle")}>
            <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-bold transition-colors", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary-faded text-primary ring-2 ring-primary" : "bg-tint text-faded")}>
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1 text-body-3 font-semibold">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
      {children}
    </label>
  )
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full rounded-lg">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {TIMES.map((t) => (
          <SelectItem key={t} value={t}>
            {formatClock(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ScheduleStep({
  draft,
  set,
  setDraft,
  locations,
  hrs,
}: {
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
  locations: ReturnType<typeof locationsFor>
  hrs: number
}) {
  const unit = locations.find((l) => l.id === draft.locationId)
  const roles = unit?.positionIds?.length ? POSITIONS.filter((p) => unit.positionIds!.includes(p.id)) : POSITIONS
  const categories = [...new Set(roles.map((p) => p.category))]
  const pickLocation = (id: string) => {
    const next = locations.find((l) => l.id === id)?.positionIds
    if (!next?.length || next.includes(draft.positionId)) return setDraft((d) => ({ ...d, locationId: id, departmentId: "" }))
    setDraft((d) => ({ ...d, locationId: id, departmentId: "", positionId: next[0], instructions: position(next[0]).duties, tips: position(next[0]).alcohol }))
  }
  const departments = unit?.departments ?? []
  const department = departmentOf(draft.locationId, draft.departmentId || undefined, draft.positionId)
  return (
    <>
      <Surface elevated className="flex flex-col gap-5 p-5">
        <h2 className="flex items-center gap-1.5 text-body-1 font-semibold">
          Work Location
          <InfoTip>Where and what. Requirements follow the position and the unit.</InfoTip>
        </h2>
        <div className={cn("grid gap-4", departments.length ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          <Field label="Location">
            <Select value={draft.locationId} onValueChange={pickLocation}>
              <SelectTrigger className="h-10 w-full rounded-lg">
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} <span className="text-faded">· {city(l.cityId).name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Position">
            <Select
              value={draft.positionId}
              onValueChange={(v) => setDraft((d) => ({ ...d, positionId: v, departmentId: "", instructions: position(v).duties, tips: position(v).alcohol }))}
            >
              <SelectTrigger className="h-10 w-full rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectGroup key={c}>
                    <SelectLabel>{c}</SelectLabel>
                    {roles.filter((p) => p.category === c).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {departments.length > 0 && (
            <Field label="Department">
              <Select value={department?.id ?? ""} onValueChange={(v) => set("departmentId", v)}>
                <SelectTrigger className="h-10 w-full rounded-lg" data-tour="booking-department">
                  <SelectValue placeholder="Choose a department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} <span className="text-faded">· {d.costCenter}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {requirementsFor([draft.positionId], draft.locationId).map((id) => (
            <StatusBadge key={id} tone="positive" size="sm">
              <ShieldCheck className="size-3" /> {requirementLabel(id)}
            </StatusBadge>
          ))}
          {unit?.minRating && (
            <StatusBadge tone="positive" size="sm">
              <ShieldCheck className="size-3" /> Rated {unit.minRating.toFixed(1)} or higher
            </StatusBadge>
          )}
        </div>
      </Surface>

      <Surface elevated className="flex flex-col gap-5 p-5">
        <h2 className="flex items-center gap-1.5 text-body-1 font-semibold">
          Build your schedule
          <InfoTip>Pick one or more dates. Each date becomes its own shift group.</InfoTip>
        </h2>
        <div className="grid gap-5 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col gap-2">
            <span className="text-body-3 font-semibold">Select date(s)</span>
            <div className="rounded-lg border border-border">
              <Calendar
                mode="multiple"
                selected={draft.dates.map((d) => parseDate(d))}
                onSelect={(days) => set("dates", (days ?? []).map((d) => toISODate(d)).sort())}
                disabled={{ before: new Date() }}
                defaultMonth={draft.dates[0] ? parseDate(draft.dates[0]) : undefined}
              />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time">
                <TimeSelect value={draft.start} onChange={(v) => set("start", v)} />
              </Field>
              <Field label="End time">
                <TimeSelect value={draft.end} onChange={(v) => set("end", v)} />
              </Field>
            </div>
            <Field label="Unpaid break" hint="Most venues give a 30 minute unpaid break on shifts over 6 hours.">
              <Select value={String(draft.breakMins)} onValueChange={(v) => set("breakMins", Number(v))}>
                <SelectTrigger className="h-10 w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 15, 30, 45, 60].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m ? `${m} minutes` : "No break"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Number of workers" hint="Per date. You can add or remove spots later from the shift.">
              <div className="flex h-10 items-center justify-between rounded-lg border border-input px-1.5">
                <Button variant="ghost" size="icon-sm" onClick={() => set("headcount", Math.max(1, draft.headcount - 1))} aria-label="Fewer workers">
                  <Minus className="size-4" />
                </Button>
                <motion.span key={draft.headcount} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-body-2 font-bold tabular">
                  {draft.headcount}
                </motion.span>
                <Button variant="ghost" size="icon-sm" onClick={() => set("headcount", Math.min(60, draft.headcount + 1))} aria-label="More workers">
                  <Plus className="size-4" />
                </Button>
              </div>
            </Field>
            <p className="rounded-lg bg-page-faded px-3 py-2 text-caption-1 text-faded">
              {draft.dates.length ? `${draft.dates.length} date${draft.dates.length === 1 ? "" : "s"}: ${draft.dates.map((d) => formatDay(d)).join(", ")}` : "No dates picked yet"} · {hrs} paid hours per worker
            </p>
          </div>
        </div>
      </Surface>

      <Surface elevated className="flex flex-col gap-4 p-5">
        <h2 className="flex items-center gap-1.5 text-body-1 font-semibold">
          Details for workers
          <InfoTip>Optional. Defaults come from the position.</InfoTip>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shift name (optional)">
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={position(draft.positionId).name} className="h-10 rounded-lg border border-input px-3 text-body-3 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
          </Field>
          <Field label="Event (optional)">
            <input value={draft.eventName} onChange={(e) => set("eventName", e.target.value)} placeholder="Concert night" className="h-10 rounded-lg border border-input px-3 text-body-3 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
          </Field>
        </div>
        <Field label="Instructions">
          <Textarea value={draft.instructions} onChange={(e) => set("instructions", e.target.value)} className="min-h-20 rounded-lg text-body-3" />
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
          <span className="flex flex-col">
            <span className="text-body-3 font-semibold">Tips eligible</span>
            <span className="text-caption-1 text-faded">Add tips per worker after the shift. They pass through with no markup.</span>
          </span>
          <Switch checked={draft.tips} onCheckedChange={(v) => set("tips", v)} />
        </div>
      </Surface>
    </>
  )
}

function ReviewStep({
  draft,
  set,
  setDraft,
  quotes,
  spots,
  preview,
  picked,
}: {
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
  quotes: Quote[]
  spots: number
  preview?: OrderPreview
  /** The buyer's pick for this role on Rate Cards, if any. */
  picked?: string
}) {
  const loc = location(draft.locationId)
  const pos = position(draft.positionId)
  const department = departmentOf(loc.id, draft.departmentId || undefined, draft.positionId)
  const gap = preview?.policy.tierGapHours ?? PROGRAM.cascadeHoursBefore
  const rows: [string, React.ReactNode][] = [
    ["Location", `${loc.name} · ${loc.address}`],
    ["Position", pos.name],
    ...(department ? [["Department", `${department.name} · ${department.costCenter}`] as [string, string]] : []),
    ["Dates", [...draft.dates].sort().map((d) => formatDay(d, "EEE, MMM d")).join(" · ")],
    ["Time", `${formatClock(draft.start)} - ${formatClock(draft.end)} (${city(loc.cityId).tz}) · ${draft.breakMins ? `${draft.breakMins} min unpaid break` : "no break"}`],
    ["Workers", `${draft.headcount} per date, ${spots} in total`],
    ["Instructions", draft.instructions || "—"],
  ]
  return (
    <Surface elevated className="flex flex-col gap-5 p-5">
      <h2 className="text-body-1 font-semibold">Review your shift</h2>
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr]">
            <dt className="text-body-3 text-faded">{label}</dt>
            <dd className="text-body-3 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2" data-tour="dispatch">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-body-3 font-semibold">
            Who gets it
            <InfoTip>
              Release order: your pick for the role sees it first, then the others by rate, {gap} hours apart until it fills. One agency: only that agency sees it, and you can ask for its workers by name.
            </InfoTip>
          </h3>
          {quotes.length > 0 && (
            <PillTabs
              size="sm"
              value={draft.dispatch}
              onChange={(v) =>
                setDraft((d) => ({ ...d, dispatch: v, proIds: [], onlyAgencyId: v === "agency" && !d.onlyAgencyId ? quotes[0].supplier.id : d.onlyAgencyId }))
              }
              items={[
                { value: "release" as const, label: "Release order" },
                { value: "agency" as const, label: "One agency" },
              ]}
            />
          )}
        </div>
        {!quotes.length ? (
          <p className="rounded-lg border border-warning-border bg-warning-faded px-4 py-3 text-body-3">
            None of your agencies staff {pos.name} in {city(loc.cityId).name}.{" "}
            <Link href="/rates" className="font-medium underline underline-offset-4">
              Compare agencies on Rate Cards
            </Link>
            .
          </p>
        ) : draft.dispatch === "agency" ? (
          <OneAgency draft={draft} setDraft={setDraft} quotes={quotes} />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" data-tour="release-order">
            {quotes.map((q, index) => {
              const low = Math.min(...quotes.map((x) => x.card.billRate))
              const why = index ? undefined : draft.firstAgencyId ? "Picked for this order" : picked === q.supplier.id ? "Your pick" : q.card.billRate === low ? "Lowest rate" : undefined
              return (
                <li key={q.supplier.id}>
                  <Tip content={index ? `Send to ${q.supplier.shortName} first` : undefined}>
                    <button
                      type="button"
                      onClick={() => index && set("firstAgencyId", q.supplier.id)}
                      aria-pressed={!index}
                      className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", index ? "hover:bg-hover" : "cursor-default bg-primary-faded/60")}
                    >
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-caption-1 font-bold tabular", index ? "bg-muted" : "bg-primary text-primary-foreground")}>{index + 1}</span>
                      <SupplierLogo supplierId={q.supplier.id} size="md" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5 truncate text-body-3 font-semibold">
                          {q.supplier.name}
                          {why && (
                            <StatusBadge tone="neutral" size="sm">
                              {why}
                            </StatusBadge>
                          )}
                        </span>
                        <span className="truncate text-caption-1 text-faded">
                          {index ? `${index * gap}h later` : preview?.held && preview.firstRelease ? `Sees it ${formatTimestamp(preview.firstRelease.toISOString())}` : "Sees it now"} · {q.metrics.slotsFilled ? `${pct(q.metrics.fillRate)} fill` : "New to your units"}
                        </span>
                      </span>
                      <span className="text-body-3 font-semibold tabular">{money(q.card.billRate)}/hr</span>
                    </button>
                  </Tip>
                </li>
              )
            })}
          </ul>
        )}
        {preview && <ReleaseNote preview={preview} />}
      </div>
    </Surface>
  )
}

/** When the sector's rule lets agencies see it. Orders that post right away need no note. */
function ReleaseNote({ preview }: { preview: OrderPreview }) {
  if (!preview.held || !preview.firstRelease) return null
  return (
    <p className="text-caption-1 text-faded">
      {preview.policy.sector} releases orders {preview.policy.releaseLeadHours} hours before the shift, so agencies see this one {formatTimestamp(preview.firstRelease.toISOString())}.
    </p>
  )
}

function OneAgency({ draft, setDraft, quotes }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; quotes: Quote[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {quotes.map((q) => {
        const on = q.supplier.id === draft.onlyAgencyId
        return (
          <li key={q.supplier.id}>
            <button
              type="button"
              onClick={() => !on && setDraft((d) => ({ ...d, onlyAgencyId: q.supplier.id, proIds: [] }))}
              aria-pressed={on}
              className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", on ? "bg-primary-faded/60" : "hover:bg-hover")}
            >
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                {on && <Check className="size-3" />}
              </span>
              <SupplierLogo supplierId={q.supplier.id} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-3 font-semibold">{q.supplier.name}</span>
                <span className="truncate text-caption-1 text-faded">{q.metrics.slotsFilled ? `${pct(q.metrics.fillRate)} fill` : "New to your units"} · fills in about {formatTimeToFill(q.metrics.hoursToFill)}</span>
              </span>
              <span className="text-body-3 font-semibold tabular">{money(q.card.billRate)}/hr</span>
            </button>
            {on && <RequestWorkers draft={draft} setDraft={setDraft} agency={q.supplier} />}
          </li>
        )
      })}
    </ul>
  )
}

/** The agency's workers the buyer knows: Favorites first, then the ones who've worked this unit, checked for the first date. */
function RequestWorkers({ draft, setDraft, agency }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; agency: Supplier }) {
  const data = useData()
  const { ws } = useWorkspace()
  const [open, setOpen] = useState(draft.proIds.length > 0)
  const loc = location(draft.locationId)
  const pos = position(draft.positionId)
  const date = [...draft.dates].sort()[0]
  const candidates = (() => {
    if (!date) return []
    const busy = new Set<string>()
    for (const g of data.groups) if (g.date === date && !g.cancelledAt) for (const slot of g.slots) if (slot.proId) busy.add(slot.proId)
    const roster = new Map(data.roster.filter((r) => r.buyerId === ws.buyerId).map((r) => [r.proId, r.status]))
    const worked = new Map<string, number>()
    for (const t of data.timesheets) if (t.locationId === loc.id && t.positionId === pos.id) worked.set(t.proId, (worked.get(t.proId) ?? 0) + 1)
    return data.pros
      .filter((p) => p.supplierId === agency.id && p.cityId === loc.cityId && p.status === "active" && p.positionIds.includes(pos.id) && roster.get(p.id) !== "blocked")
      .map((p) => {
        const check = canWork(p, pos.id, date, loc.id)
        return { pro: p, favorite: roster.get(p.id) === "favorite", worked: worked.get(p.id) ?? 0, reason: !check.ok ? check.reason : busy.has(p.id) ? "Booked elsewhere that day" : undefined }
      })
      .sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || Number(b.favorite) - Number(a.favorite) || b.worked - a.worked || b.pro.rating - a.pro.rating)
      .slice(0, 12)
  })()
  const toggle = (id: string) =>
    setDraft((d) => ({ ...d, proIds: d.proIds.includes(id) ? d.proIds.filter((x) => x !== id) : d.proIds.length < d.headcount ? [...d.proIds, id] : d.proIds }))
  if (!open)
    return (
      <div className="border-t border-border/70 bg-primary-faded/30 px-4 py-2.5 pl-11">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-body-3 font-medium hover:underline" data-tour="request-workers">
          <Plus className="size-3.5" /> Ask for {agency.shortName} workers by name
        </button>
      </div>
    )
  return (
    <div className="flex flex-col gap-2 border-t border-border/70 bg-primary-faded/30 px-4 py-3 pl-11">
      <span className="text-caption-1 font-medium text-faded">
        {draft.proIds.length ? `${draft.proIds.length} of ${draft.headcount} asked for. They're booked first if they're still cleared and free.` : `Pick up to ${draft.headcount}. ${agency.shortName} fills the rest.`}
      </span>
      {candidates.length ? (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card scrollbar-thin" data-tour="request-pros">
          {candidates.map(({ pro, favorite, worked, reason }) => {
            const on = draft.proIds.includes(pro.id)
            return (
              <li key={pro.id}>
                <button
                  type="button"
                  disabled={!!reason || (!on && draft.proIds.length >= draft.headcount)}
                  onClick={() => toggle(pro.id)}
                  aria-pressed={on}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60", on ? "bg-primary-faded/60" : "hover:bg-hover")}
                >
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                    {on && <Check className="size-3" />}
                  </span>
                  <ProAvatar pro={pro} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1 truncate text-body-3 font-semibold">
                      {pro.firstName} {pro.lastName}
                      {favorite && <Heart className="size-3 fill-critical text-critical" />}
                    </span>
                    <span className="truncate text-caption-1 text-faded">{worked ? `${worked} shifts here` : favorite ? "Favorite" : pro.rating ? `Rated ${pro.rating.toFixed(1)}` : "New"}</span>
                  </span>
                  {reason && (
                    <StatusBadge tone={/expired|missing|pending/i.test(reason) ? "critical" : "neutral"} size="sm">
                      {reason}
                    </StatusBadge>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-body-3 text-faded">
          No {agency.shortName} {pos.name.toLowerCase()}s in {city(loc.cityId).name} yet.
        </p>
      )}
    </div>
  )
}

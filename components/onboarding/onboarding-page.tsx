"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, ChevronRight, MapPinned, Plus, ShieldCheck } from "lucide-react"
import { Fragment, useEffect, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { SearchInput } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { daysFromToday, formatDateShort } from "@/lib/dates"
import { plural } from "@/lib/format"
import { complianceScore, scoreTone } from "@/lib/metrics"
import { BUYERS, LOCATIONS, SUPPLIERS, buyer, city, position, requirementLabel } from "@/lib/reference"
import type { DemoData, Location, Supplier } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Everyone in the program: the units that buy labor and the agencies that supply it, what each one needs to work, and
 * the way to add more. What Compass does today by uploading buyers, suppliers and rate cards.
 */

const added = (o?: { at: string; by: string }) =>
  o ? (
    <span className="flex flex-col">
      <span className="font-medium">{formatDateShort(o.at.slice(0, 10))}</span>
      <span className="text-caption-1 text-faded">{o.by}</span>
    </span>
  ) : (
    <span className="text-faded">At launch</span>
  )

const staffing = (data: DemoData, l: Location) =>
  (data.approvals[l.buyerId] ?? []).filter((id) => data.rateCards.some((c) => c.supplierId === id && c.cityId === l.cityId && c.status === "active"))

const averageMarkup = (data: DemoData, supplierId: string) => {
  const cards = data.rateCards.filter((c) => c.supplierId === supplierId && c.status === "active")
  return cards.length ? cards.reduce((sum, c) => sum + c.markupPct, 0) / cards.length : undefined
}

const coiDays = (s: Supplier) => (s.onboarded ? daysFromToday(s.onboarded.coiExpiresOn) : s.coiExpiresInDays)

const LEVELS = ["Super sector", "Sector", "Regional business"]

interface Branch {
  id: string
  name: string
  depth: number
  children: Branch[]
  units: Location[]
}

/** The units, filed the way Compass is organized. A unit lands under its buyer, so a new one files itself. */
function unitTree(units: Location[]) {
  const root: Branch = { id: "root", name: "", depth: -1, children: [], units: [] }
  for (const b of BUYERS) {
    const mine = units.filter((l) => l.buyerId === b.id)
    if (!mine.length) continue
    const path = [
      [`s:${b.sector}`, b.sector],
      [`b:${b.brand}`, b.brand],
      [`r:${b.id}`, b.name],
    ]
    let node = root
    for (const [depth, [id, name]] of path.entries()) {
      let child = node.children.find((c) => c.id === id)
      if (!child) {
        child = { id, name, depth, children: [], units: [] }
        node.children.push(child)
      }
      node = child
    }
    node.units.push(...[...mine].sort((x, y) => Number(!!y.onboarded) - Number(!!x.onboarded) || x.name.localeCompare(y.name)))
  }
  return root.children
}

const unitCount = (b: Branch): number => b.units.length + b.children.reduce((n, c) => n + unitCount(c), 0)

const has = (text: string, q: string) => !!q && text.toLowerCase().includes(q)

function Hit({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warning-faded px-0.5 text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function UnitsPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const fresh = useSearchParams().get("unit") ?? undefined
  const [query, setQuery] = useState("")
  const [closed, setClosed] = useState<Set<string>>(() => {
    const next = new Set(["s:Education"])
    const added = fresh ? LOCATIONS.find((l) => l.id === fresh) : undefined
    if (added) next.delete(`s:${buyer(added.buyerId).sector}`)
    return next
  })
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const q = query.trim().toLowerCase()

  const unitHit = (l: Location) => {
    const b = buyer(l.buyerId)
    return [l.name, l.kind, l.costCenter, city(l.cityId).name, b.name, b.brand, b.sector].some((t) => has(t, q))
  }
  const deptHits = (l: Location) => (l.departments ?? []).filter((d) => has(d.name, q) || has(d.costCenter, q))
  const shown = q ? LOCATIONS.filter((l) => unitHit(l) || deptHits(l).length > 0) : LOCATIONS
  const tree = unitTree(shown)
  const costCenters = LOCATIONS.reduce((n, l) => n + 1 + (l.departments?.length ?? 0), 0)

  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => document.querySelector(`tr[data-row-id="${fresh}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150)
    return () => clearTimeout(t)
  }, [fresh])

  const flip = (set: typeof setClosed, id: string) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const td = "px-3 py-2.5 align-middle text-body-3 whitespace-nowrap"
  const indent = (depth: number) => ({ paddingLeft: 12 + depth * 20 })
  const chevron = (open: boolean) => <ChevronRight className={cn("size-3.5 shrink-0 text-faded transition-transform duration-100", open && "rotate-90")} />

  const unitRows = (l: Location) => {
    const depts = l.departments ?? []
    const matched = q && !unitHit(l) ? deptHits(l) : []
    const open = matched.length > 0 || opened.has(l.id)
    const listed = matched.length ? matched : depts
    return (
      <Fragment key={l.id}>
        <tr
          data-row-id={l.id}
          onClick={depts.length ? () => flip(setOpened, l.id) : undefined}
          aria-expanded={depts.length ? open : undefined}
          className={cn("border-b border-border/70 transition-colors duration-100", depts.length && "cursor-pointer hover:bg-hover", fresh === l.id && "bg-positive-faded hover:bg-positive-faded")}
        >
          <td className={td} style={indent(LEVELS.length)}>
            <span className="flex items-center gap-1.5">
              {depts.length ? chevron(open) : <span className="size-3.5 shrink-0" />}
              <span className="flex flex-col">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Hit text={l.name} q={q} />
                  {l.onboarded && (
                    <StatusBadge tone="primary" size="sm">
                      New
                    </StatusBadge>
                  )}
                </span>
                <span className="text-caption-1 text-faded">
                  {l.kind}
                  {depts.length > 0 && ` · ${plural(depts.length, "department")}`}
                </span>
              </span>
            </span>
          </td>
          <td className={td}>
            <code className="font-mono text-caption-1">
              <Hit text={l.costCenter} q={q} />
            </code>
          </td>
          <td className={td}>
            {city(l.cityId).name}, {city(l.cityId).state}
          </td>
          <td className={td}>
            {l.positionIds?.length ? (
              <Tip content={l.positionIds.map((id) => position(id).name).join(", ")}>
                <span>{plural(l.positionIds.length, "role")}</span>
              </Tip>
            ) : (
              <span className="text-faded">Any role</span>
            )}
          </td>
          <td className={cn(td, "whitespace-normal")}>
            {l.requires?.length ? (
              <span className="flex flex-wrap gap-1">
                {l.requires.map((r) => (
                  <StatusBadge key={r} tone="primary" size="sm">
                    <ShieldCheck className="size-3" /> {requirementLabel(r)}
                  </StatusBadge>
                ))}
              </span>
            ) : (
              <span className="text-faded">Program standard</span>
            )}
          </td>
          <td className={td}>
            <span className="flex -space-x-1">
              {staffing(data, l).map((id) => (
                <Tip key={id} content={SUPPLIERS.find((s) => s.id === id)?.shortName}>
                  <span className="inline-flex">
                    <SupplierLogo supplierId={id} size="sm" className="ring-2 ring-card" />
                  </span>
                </Tip>
              ))}
            </span>
          </td>
          <td className={td}>{added(l.onboarded)}</td>
        </tr>
        {open &&
          listed.map((d) => (
            <tr key={d.id} data-row-id={`${l.id}:${d.id}`} className="border-b border-border/70 bg-page-faded/50">
              <td className={td} style={indent(LEVELS.length + 1)}>
                <span className="flex items-center gap-1.5 pl-5 font-medium">
                  <Hit text={d.name} q={q} />
                </span>
              </td>
              <td className={td}>
                <code className="font-mono text-caption-1">
                  <Hit text={d.costCenter} q={q} />
                </code>
              </td>
              <td className={td} />
              <td className={td}>
                {d.positionIds?.length ? (
                  <Tip content={d.positionIds.map((id) => position(id).name).join(", ")}>
                    <span>{plural(d.positionIds.length, "role")}</span>
                  </Tip>
                ) : (
                  <span className="text-faded">Any role</span>
                )}
              </td>
              <td className={td} colSpan={3} />
            </tr>
          ))}
      </Fragment>
    )
  }

  const branchRows = (nodes: Branch[]): React.ReactNode =>
    nodes.map((n) => {
      const open = !!q || !closed.has(n.id)
      return (
        <Fragment key={n.id}>
          <tr
            data-row-id={n.id}
            onClick={() => flip(setClosed, n.id)}
            aria-expanded={open}
            className={cn("cursor-pointer border-b border-border/70 transition-colors duration-100 hover:bg-hover", n.depth === 0 && "bg-page-faded/60")}
          >
            <td className={td} style={indent(n.depth)} colSpan={7}>
              <span className="flex items-center gap-1.5">
                {chevron(open)}
                <span className="font-semibold">
                  <Hit text={n.name} q={q} />
                </span>
                <span className="text-caption-2 text-faded">
                  {LEVELS[n.depth]} · {plural(unitCount(n), "unit")}
                </span>
              </span>
            </td>
          </tr>
          {open && (
            <>
              {branchRows(n.children)}
              {n.units.map(unitRows)}
            </>
          )}
        </Fragment>
      )
    })

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Units"
        description="Every unit that buys labor, filed under its super sector, sector and regional business. Add one and it's live across Iris."
        actions={
          ws.kind === "compass" && (
            <Button asChild data-tour="add-unit">
              <Link href="/units/new">
                <MapPinned /> Add a unit
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div data-tour="unit-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Search units or cost centers" className="w-72" />
        </div>
        <span className="text-caption-1 text-faded">
          {plural(LOCATIONS.length, "unit")} · {plural(costCenters, "cost center")}
        </span>
      </div>
      <Surface elevated className="overflow-hidden" data-tour="units-table">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {["Unit", "Cost center", "Market", "Orders", "Also requires", "Staffed by", "Added"].map((h) => (
                  <th key={h} className="h-9 px-3 text-caption-1 font-medium whitespace-nowrap text-faded">
                    {h === "Also requires" ? (
                      <span className="inline-flex items-center gap-1">
                        {h}
                        <InfoTip>On top of the program&apos;s background check, I-9 and Compass orientation, and each role&apos;s certificates.</InfoTip>
                      </span>
                    ) : h === "Staffed by" ? (
                      <span className="inline-flex items-center gap-1">
                        {h}
                        <InfoTip>The buyer&apos;s approved agencies with rates in this market.</InfoTip>
                      </span>
                    ) : (
                      h
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branchRows(tree)}
              {!tree.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-body-3 text-faded">
                    No unit or cost center matches &ldquo;{query.trim()}&rdquo;
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Surface>
      {ws.kind === "compass" && (
        <p className="flex items-center gap-1.5 text-caption-1 text-faded">
          <Plus className="size-3.5" />
          Units can also come from the buyer: its admin adds one from Settings, Work locations.
        </p>
      )}
    </>
  )
}

export function AgenciesPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const agencies = [...SUPPLIERS].sort((a, b) => Number(!!b.onboarded) - Number(!!a.onboarded))

  const columns: Column<Supplier>[] = [
    {
      id: "agency",
      header: "Agency",
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex items-center gap-2.5">
          <SupplierLogo supplierId={s.id} size="md" />
          <span className="flex flex-col">
            <span className="flex items-center gap-1.5 font-semibold">
              {s.name}
              {s.onboarded && (
                <StatusBadge tone="primary" size="sm">
                  New
                </StatusBadge>
              )}
            </span>
            <Tip content={s.integrationDetail}>
              <span className="w-fit text-caption-1 text-faded">{s.integrationDetail.split(":")[0]}</span>
            </Tip>
          </span>
        </span>
      ),
    },
    {
      id: "markets",
      header: "Markets",
      align: "right",
      sortValue: (s) => s.cityIds.length,
      cell: (s) => (
        <Tip content={s.cityIds.map((c) => city(c).name).join(", ")}>
          <span className="font-medium">{s.cityIds.length}</span>
        </Tip>
      ),
    },
    {
      id: "insurance",
      header: "Insurance",
      sortValue: coiDays,
      cell: (s) => {
        const days = coiDays(s)
        return (
          <StatusBadge tone={days <= 14 ? "critical" : days <= 30 ? "warning" : "positive"} size="sm">
            {days <= 30 ? `Expires in ${plural(days, "day")}` : "Valid"}
          </StatusBadge>
        )
      },
    },
    {
      id: "markup",
      header: "Markup",
      info: "Average across the agency's active rates.",
      align: "right",
      sortValue: (s) => averageMarkup(data, s.id) ?? 0,
      cell: (s) => {
        const markup = averageMarkup(data, s.id)
        return markup === undefined ? <span className="text-faded">None yet</span> : <span className="font-medium">{markup.toFixed(0)}%</span>
      },
    },
    {
      id: "pros",
      header: "Workers",
      align: "right",
      sortValue: (s) => complianceScore(data, s.id).active,
      cell: (s) => {
        const c = complianceScore(data, s.id)
        return c.onboarding ? (
          <Tip content={`${c.onboarding} more onboarding`}>
            <span className="font-medium">{c.active}</span>
          </Tip>
        ) : (
          <span className="font-medium">{c.active}</span>
        )
      },
    },
    {
      id: "compliance",
      header: "Compliance",
      info: "Mostly the share of active workers cleared to work today; the rest is the share with no document expiring in the next 30 days.",
      align: "right",
      sortValue: (s) => complianceScore(data, s.id).score,
      cell: (s) => {
        const c = complianceScore(data, s.id)
        if (!c.active) return <span className="text-faded">No workers yet</span>
        return (
          <Tip content={`${c.cleared} of ${c.active} cleared today · ${plural(c.expiring, "worker")} with a document expiring within 30 days${c.held ? ` · ${plural(c.held, "document")} held for Compass` : ""}`}>
            <span className="inline-flex">
              <StatusBadge tone={scoreTone(c.score)} size="sm">
                {c.score}%
              </StatusBadge>
            </span>
          </Tip>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Agencies"
        description="Every agency on the program. Open one for its rates, workers, paperwork, connection and performance in one place."
        actions={
          ws.kind === "compass" && (
            <Button asChild data-tour="add-agency">
              <Link href="/agencies/new">
                <Building2 /> Add an agency
              </Link>
            </Button>
          )
        }
      />
      <Surface elevated className="overflow-hidden" data-tour="agencies-table">
        <DataTable rows={agencies} columns={columns} getRowId={(s) => s.id} onRowClick={(s) => router.push(`/agencies/${s.id}`)} pageSize={25} />
      </Surface>
    </>
  )
}

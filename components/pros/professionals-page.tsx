"use client"

import { useSearchParams } from "next/navigation"
import { Download, FileUp, Users } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { MultiSelectFilter, ResetFilters, SearchInput } from "@/components/common/filters"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { ProAvatar } from "@/components/common/pro-avatar"
import { SyncedBadge } from "@/components/common/synced-badge"
import { ProSheet } from "@/components/pros/pro-sheet"
import { ComplianceBadge, OnboardingLabel, Rating } from "@/components/pros/pro-status"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import { downloadCsv, exportName, isSynced, toCsv } from "@/lib/csv"
import { fullName } from "@/lib/format"
import { prosFor } from "@/lib/metrics"
import { complianceOf, onboardingOf, standingOf, type ComplianceStatus, type OnboardingStatus, type ProStanding } from "@/lib/pro-profile"
import { POSITIONS, SUPPLIERS, cityLabel, position, supplier } from "@/lib/reference"
import type { Pro } from "@/lib/types"

type Filter = "all" | ProStanding

interface Row {
  pro: Pro
  standing: ProStanding
  onboarding: OnboardingStatus
  compliance: ComplianceStatus
  shifts: number
}

const FILTERS: { value: Filter; label: string; tooltip?: string; empty?: { title: string; description: string } }[] = [
  { value: "all", label: "All" },
  {
    value: "onboarding",
    label: "Onboarding",
    tooltip: "New Pros still finishing their documents. They can't work yet.",
    empty: { title: "No one is onboarding", description: "New Pros show up here until every document they need is complete." },
  },
  {
    value: "not_compliant",
    label: "Not compliant",
    tooltip: "A required document is missing, pending or expired. Iris won't place them until it's fixed.",
    empty: { title: "Everyone is compliant", description: "No active Pro has a missing or expired document." },
  },
  {
    value: "compliant",
    label: "Compliant",
    tooltip: "Cleared to work. Some have a document expiring within 30 days.",
    empty: { title: "No one is cleared yet", description: "Pros show up here once every document they need is complete." },
  },
]

const TONE_RANK = { positive: 0, warning: 1, critical: 2 }

const parseFilter = (value: string | null): Filter => FILTERS.find((f) => f.value === value)?.value ?? "all"

const replaceParam = (key: string, value?: string) => {
  const next = new URLSearchParams(window.location.search)
  if (value) next.set(key, value)
  else next.delete(key)
  const query = next.toString()
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
}

export function ProfessionalsPage() {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const params = useSearchParams()
  const openUpload = useUi((s) => s.openUpload)
  const [filter, setFilter] = useState<Filter>(() => parseFilter(params.get("filter")))
  const [query, setQuery] = useState("")
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [positions, setPositions] = useState<string[]>([])
  const [closingId, setClosingId] = useState<string>()
  const buyerId = ws.kind === "buyer" ? ws.buyerId : undefined
  const showSupplier = ws.kind !== "supplier"

  const pros = prosFor(data, scope)
  const shiftsHere = useMemo(() => {
    const counts = new Map<string, number>()
    if (buyerId) for (const t of data.timesheets) if (t.buyerId === buyerId) counts.set(t.proId, (counts.get(t.proId) ?? 0) + 1)
    return counts
  }, [data.timesheets, buyerId])
  const rows = useMemo<Row[]>(
    () =>
      pros.map((pro) => ({
        pro,
        standing: standingOf(pro),
        onboarding: onboardingOf(pro),
        compliance: complianceOf(pro),
        shifts: buyerId ? (shiftsHere.get(pro.id) ?? 0) : pro.shiftsWorked,
      })),
    [pros, shiftsHere, buyerId],
  )
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(({ pro }) => {
      if (q && !`${fullName(pro)} ${pro.code}`.toLowerCase().includes(q)) return false
      if (suppliers.length && !suppliers.includes(pro.supplierId)) return false
      if (positions.length && !pro.positionIds.some((id) => positions.includes(id))) return false
      return true
    })
  }, [rows, query, suppliers, positions])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: matching.length, onboarding: 0, not_compliant: 0, compliant: 0 }
    for (const r of matching) c[r.standing]++
    return c
  }, [matching])
  const visible = useMemo(() => (filter === "all" ? matching : matching.filter((r) => r.standing === filter)), [matching, filter])

  const urlPro = params.get("pro")
  const openId = urlPro && pros.some((p) => p.id === urlPro) ? urlPro : undefined
  const openPro = (id: string) => replaceParam("pro", id)
  const closePro = () => {
    setClosingId(openId)
    replaceParam("pro")
  }

  const changeFilter = (next: Filter) => {
    setFilter(next)
    replaceParam("filter", next === "all" ? undefined : next)
  }
  const hasFilters = !!query || suppliers.length + positions.length > 0
  const clearAll = () => {
    setQuery("")
    setSuppliers([])
    setPositions([])
    changeFilter("all")
  }

  const exportCsv = () =>
    downloadCsv(
      exportName("professionals"),
      toCsv(
        visible.map(({ pro, onboarding, compliance, shifts }) => ({
          pro_id: pro.code,
          first_name: pro.firstName,
          last_name: pro.lastName,
          supplier: supplier(pro.supplierId).name,
          city: cityLabel(pro.cityId),
          positions: pro.positionIds.map((id) => position(id).name).join(";"),
          onboarding: onboarding.label,
          compliance: compliance.label,
          rating: pro.rating ? pro.rating.toFixed(1) : "",
          shifts,
        })),
        ["pro_id", "first_name", "last_name", "supplier", "city", "positions", "onboarding", "compliance", "rating", "shifts"],
      ),
    )

  const columns: Column<Row>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (r) => fullName(r.pro),
      cell: ({ pro }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openPro(pro.id)
          }}
          className="flex items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ProAvatar pro={pro} size="md" ring />
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{fullName(pro)}</span>
            <span className="text-caption-1 text-faded">{pro.code}</span>
          </span>
        </button>
      ),
    },
    ...(showSupplier
      ? [
          {
            id: "supplier",
            header: "Supplier",
            sortValue: (r: Row) => supplier(r.pro.supplierId).shortName,
            cell: (r: Row) => (
              <span className="inline-flex items-center gap-2">
                <SupplierLogo supplierId={r.pro.supplierId} size="sm" />
                {supplier(r.pro.supplierId).shortName}
              </span>
            ),
          } satisfies Column<Row>,
        ]
      : []),
    {
      id: "onboarding",
      header: "Onboarding",
      info: "New Pros finish onboarding when every document their positions need is complete.",
      sortValue: (r) => r.onboarding.left,
      cell: (r) => <OnboardingLabel status={r.onboarding} />,
    },
    {
      id: "compliance",
      header: "Compliance",
      info: "Background check (BGC), I-9, Compass orientation and the food handler or alcohol certs each position needs.",
      sortValue: (r) => TONE_RANK[r.compliance.tone] * 10 + r.compliance.issues.length,
      cell: (r) => <ComplianceBadge status={r.compliance} />,
    },
    { id: "rating", header: "Rating", align: "right", sortValue: (r) => r.pro.rating, cell: (r) => <Rating value={r.pro.rating} /> },
    {
      id: "shifts",
      header: "Shifts",
      info: buyerId ? "Shifts worked at your locations." : "Shifts worked on Iris.",
      align: "right",
      sortValue: (r) => r.shifts,
      cell: (r) => r.shifts,
    },
  ]

  const empty = hasFilters
    ? { title: "No professionals match", description: "Try a different name, supplier or position." }
    : (FILTERS.find((f) => f.value === filter)?.empty ?? {
        title: "No professionals yet",
        description:
          ws.kind === "supplier"
            ? "Upload a CSV of your Pros to start their onboarding."
            : ws.kind === "buyer"
              ? "Pros show up here once they're booked at your locations."
              : "No supplier has added Pros yet.",
      })

  return (
    <>
      <PageHeader
        className="pt-4"
        title={ws.kind === "supplier" ? "My Professionals" : "Professionals"}
        description={
          ws.kind === "supplier"
            ? "Your Pros, their onboarding and the documents Compass requires. Open a Pro for their resume, interviews, offers, documents and reviews."
            : ws.kind === "buyer"
              ? "Pros who worked or are booked at your locations, from every supplier. Rate them after a shift, and favorite or block them from their profile."
              : "Every Pro across every supplier and whether they're cleared to work Compass shifts."
        }
        actions={
          <>
            <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={exportCsv}>
              <Download className="size-4" /> Download
            </Button>
            {ws.kind === "supplier" &&
              ws.supplierId &&
              (isSynced(ws, "professionals") ? (
                <SyncedBadge supplierId={ws.supplierId} />
              ) : (
                <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => openUpload("professionals")}>
                  <FileUp className="size-4" /> Upload CSV
                </Button>
              ))}
          </>
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs value={filter} onChange={changeFilter} items={FILTERS.map((f) => ({ value: f.value, label: f.label, tooltip: f.tooltip, count: counts[f.value] }))} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Name or Pro ID" className="w-52" />
            {showSupplier && (
              <MultiSelectFilter
                label="Suppliers"
                options={SUPPLIERS.filter((s) => rows.some((r) => r.pro.supplierId === s.id)).map((s) => ({
                  value: s.id,
                  label: s.name,
                  icon: <SupplierLogo supplierId={s.id} size="xs" />,
                }))}
                value={suppliers}
                onChange={setSuppliers}
              />
            )}
            <MultiSelectFilter
              label="Positions"
              searchable
              options={POSITIONS.map((p) => ({ value: p.id, label: p.name, hint: p.category }))}
              value={positions}
              onChange={setPositions}
            />
            <ResetFilters show={hasFilters} onClick={() => (setQuery(""), setSuppliers([]), setPositions([]))} />
          </div>
        </div>
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(r) => r.pro.id}
          onRowClick={(r) => openPro(r.pro.id)}
          initialSort={{ id: "name", dir: "asc" }}
          empty={
            <EmptyState
              icon={Users}
              title={empty.title}
              description={empty.description}
              actions={
                hasFilters || filter !== "all" ? (
                  <Button variant="outline" onClick={clearAll}>
                    Show everyone
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>
      <ProSheet proId={openId ?? closingId} open={!!openId} onOpenChange={(o) => !o && closePro()} />
    </>
  )
}

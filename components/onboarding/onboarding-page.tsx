"use client"

import { useRouter } from "next/navigation"
import { Building2, MapPinned, Plus, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { AgencyDialog } from "@/components/onboarding/agency-dialog"
import { UnitDialog } from "@/components/onboarding/unit-dialog"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { readiness } from "@/lib/compliance"
import { daysFromToday, formatDateShort } from "@/lib/dates"
import { pct, plural } from "@/lib/format"
import { BUYERS, LOCATIONS, SUPPLIERS, buyer, city, position, requirementLabel } from "@/lib/reference"
import type { DemoData, Location, Supplier } from "@/lib/types"

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

const coiDays = (s: Supplier) => (s.onboarded ? daysFromToday(s.onboarded.coiExpiresOn) : s.coiExpiresInDays)

export function UnitsPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const [adding, setAdding] = useState(false)
  const units = [...LOCATIONS].sort((a, b) => Number(!!b.onboarded) - Number(!!a.onboarded) || a.buyerId.localeCompare(b.buyerId))

  const columns: Column<Location>[] = [
    {
      id: "unit",
      header: "Unit",
      sortValue: (l) => l.name,
      cell: (l) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-1.5 font-semibold">
            {l.name}
            {l.onboarded && (
              <StatusBadge tone="primary" size="sm">
                New
              </StatusBadge>
            )}
          </span>
          <span className="text-caption-1 text-faded">{l.kind}</span>
        </span>
      ),
    },
    { id: "buyer", header: "Buyer", sortValue: (l) => buyer(l.buyerId).name, cell: (l) => buyer(l.buyerId).name },
    { id: "market", header: "Market", sortValue: (l) => city(l.cityId).name, cell: (l) => `${city(l.cityId).name}, ${city(l.cityId).state}` },
    { id: "cc", header: "Cost center", cell: (l) => <code className="font-mono text-caption-1">{l.costCenter}</code> },
    {
      id: "roles",
      header: "Orders",
      cell: (l) =>
        l.positionIds?.length ? (
          <Tip content={l.positionIds.map((id) => position(id).name).join(", ")}>
            <span>{plural(l.positionIds.length, "role")}</span>
          </Tip>
        ) : (
          <span className="text-faded">Any role</span>
        ),
    },
    {
      id: "requires",
      header: "Also requires",
      info: "On top of the program's background check, I-9 and Compass orientation, and each role's certificates.",
      className: "whitespace-normal",
      cell: (l) =>
        l.requires?.length || l.minRating ? (
          <span className="flex flex-wrap gap-1">
            {l.requires?.map((r) => (
              <StatusBadge key={r} tone="primary" size="sm">
                <ShieldCheck className="size-3" /> {requirementLabel(r)}
              </StatusBadge>
            ))}
            {l.minRating && (
              <StatusBadge tone="primary" size="sm">
                Rated {l.minRating.toFixed(1)}+
              </StatusBadge>
            )}
          </span>
        ) : (
          <span className="text-faded">Program standard</span>
        ),
    },
    {
      id: "agencies",
      header: "Staffed by",
      info: "The buyer's approved agencies with rates in this market, in release order.",
      cell: (l) => (
        <span className="flex -space-x-1">
          {staffing(data, l).map((id) => (
            <Tip key={id} content={SUPPLIERS.find((s) => s.id === id)?.shortName}>
              <span className="inline-flex">
                <SupplierLogo supplierId={id} size="sm" className="ring-2 ring-card" />
              </span>
            </Tip>
          ))}
        </span>
      ),
    },
    { id: "added", header: "Added", sortValue: (l) => l.onboarded?.at ?? "", cell: (l) => added(l.onboarded) },
  ]

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Units"
        description="Every unit that buys labor, with its cost center, the roles it orders and anything it requires. Add one and it's live across Iris: booking, release order, compliance and invoices."
        actions={
          ws.kind === "compass" && (
            <Button onClick={() => setAdding(true)} data-tour="add-unit">
              <MapPinned /> Add a unit
            </Button>
          )
        }
      />
      <Surface elevated className="overflow-hidden" data-tour="units-table">
        <DataTable rows={units} columns={columns} getRowId={(l) => l.id} pageSize={25} />
      </Surface>
      {ws.kind === "compass" && (
        <p className="flex items-center gap-1.5 text-caption-1 text-faded">
          <Plus className="size-3.5" />
          Units can also come from the buyer: its admin adds one from Settings, Work locations.
        </p>
      )}
      <UnitDialog open={adding} onOpenChange={setAdding} />
    </>
  )
}

export function AgenciesPage() {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const [adding, setAdding] = useState(false)
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
            <span className="text-caption-1 text-faded">{s.integrationDetail}</span>
          </span>
        </span>
      ),
    },
    { id: "markets", header: "Markets", cell: (s) => s.cityIds.map((c) => city(c).name).join(", ") },
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
      id: "rates",
      header: "Rate card",
      align: "right",
      cell: (s) => {
        const cards = data.rateCards.filter((c) => c.supplierId === s.id && c.status === "active")
        const markup = cards.length ? cards.reduce((sum, c) => sum + c.markupPct, 0) / cards.length : 0
        return (
          <span className="flex flex-col items-end">
            <span className="font-medium tabular">{plural(cards.length, "rate")}</span>
            <span className="text-caption-1 text-faded tabular">{cards.length ? `${markup.toFixed(0)}% average markup` : "None yet"}</span>
          </span>
        )
      },
    },
    {
      id: "pros",
      header: "Pros",
      align: "right",
      cell: (s) => {
        const pros = data.pros.filter((p) => p.supplierId === s.id && p.status === "active")
        const cleared = pros.filter((p) => readiness(p).ready).length
        return (
          <span className="flex flex-col items-end">
            <span className="font-medium tabular">{pros.length}</span>
            <span className="text-caption-1 text-faded tabular">{pros.length ? `${pct(cleared / pros.length)} cleared` : "None yet"}</span>
          </span>
        )
      },
    },
    {
      id: "buyers",
      header: "Approved by",
      cell: (s) => {
        const by = BUYERS.filter((b) => data.approvals[b.id]?.includes(s.id))
        return by.length ? (
          <span className="flex flex-col">
            {by.map((b) => (
              <span key={b.id}>{b.name}</span>
            ))}
          </span>
        ) : (
          <span className="text-faded">No buyers yet</span>
        )
      },
    },
    { id: "added", header: "Added", sortValue: (s) => s.onboarded?.at ?? "", cell: (s) => added(s.onboarded) },
  ]

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Agencies"
        description="Every agency on the program. Open one for its rates, Pros, paperwork, connection and performance in one place."
        actions={
          ws.kind === "compass" && (
            <Button onClick={() => setAdding(true)} data-tour="add-agency">
              <Building2 /> Add an agency
            </Button>
          )
        }
      />
      <Surface elevated className="overflow-hidden" data-tour="agencies-table">
        <DataTable rows={agencies} columns={columns} getRowId={(s) => s.id} onRowClick={(s) => router.push(`/agencies/${s.id}`)} pageSize={25} />
      </Surface>
      <AgencyDialog open={adding} onOpenChange={setAdding} />
    </>
  )
}

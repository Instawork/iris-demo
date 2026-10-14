"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, Download } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { Tip } from "@/components/common/info-tip"
import { SectionTitle } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Greeting, TodoSection } from "@/components/home/shared"
import { SupplierProfileDialog } from "@/components/home/supplier-profile-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { addDaysISO, todayISO } from "@/lib/dates"
import { moneyWhole, pct } from "@/lib/format"
import {
  invoiceBenchmark,
  invoiceTotal,
  locationRanking,
  metricsFor,
  needsReview,
  supplierScore,
  todosFor,
  type LocationRank,
  type SupplierMetrics,
} from "@/lib/metrics"
import { BUYERS, LOCATIONS, SUPPLIERS, buyer, location, supplier } from "@/lib/reference"
import { cn } from "@/lib/utils"

interface SupplierRank {
  id: string
  score: number
  m: SupplierMetrics
}

const changeLabel = (r: LocationRank) => `${r.change >= 0 ? "+" : "−"}${pct(Math.abs(r.change))}`

export function CompassHome() {
  const data = useData()
  const { ws } = useWorkspace()
  const todos = useMemo(() => todosFor(data, ws), [data, ws])
  const locations = useMemo(() => locationRanking(data, "all"), [data])
  const suppliers = useMemo<SupplierRank[]>(
    () =>
      SUPPLIERS.map((s) => {
        const m = metricsFor(data, s.id)
        return { id: s.id, m, score: supplierScore(m) }
      }).sort((a, b) => b.score - a.score),
    [data],
  )
  const [profile, setProfile] = useState<string>()
  const [drill, setDrill] = useState<string>()

  const locationColumns: Column<LocationRank>[] = [
    { id: "rank", header: "#", className: "w-10", cell: (r) => <span className="text-faded tabular">{locations.indexOf(r) + 1}</span> },
    {
      id: "location",
      header: "Location",
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{location(r.locationId).name}</span>
          <span className="truncate text-caption-1 text-faded">{buyer(r.buyerId).name}</span>
        </span>
      ),
    },
    { id: "spend", header: "Spend", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="font-medium tabular">{moneyWhole(r.amount)}</span> },
    {
      id: "change",
      header: "Last week",
      info: "Last 7 days against this location's normal week (the average of the two weeks before).",
      align: "right",
      sortValue: (r) => r.change,
      cell: (r) => <span className={cn("tabular", r.aboveNormal ? "font-medium text-critical-fg" : "text-faded")}>{changeLabel(r)}</span>,
    },
    {
      id: "flags",
      header: "",
      className: "w-24",
      cell: (r) => (
        <span className="flex items-center justify-end gap-1.5">
          {r.anomalous > 0 && (
            <Tip content={`${r.anomalous} anomalous invoice${r.anomalous === 1 ? "" : "s"} to review`}>
              <span className="flex">
                <StatusBadge tone="critical" size="sm">
                  {r.anomalous}
                </StatusBadge>
              </span>
            </Tip>
          )}
          {r.aboveNormal && (
            <Tip content={`Last 7 days ran ${pct(r.change)} above its normal week`}>
              <AlertTriangle className="size-4 text-critical-fg" />
            </Tip>
          )}
        </span>
      ),
    },
  ]

  const supplierColumns: Column<SupplierRank>[] = [
    { id: "rank", header: "#", className: "w-10", cell: (r) => <span className="text-faded tabular">{suppliers.indexOf(r) + 1}</span> },
    {
      id: "supplier",
      header: "Supplier",
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <SupplierLogo supplierId={r.id} size="sm" />
          <span className="font-medium">{supplier(r.id).shortName}</span>
        </span>
      ),
    },
    {
      id: "score",
      header: "Score",
      info: "Out of 100, from fill rate, no-shows, compliance and time to fill over the last 28 days.",
      sortValue: (r) => r.score,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="w-7 font-semibold tabular">{r.score}</span>
          <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-muted sm:block">
            <span className="block h-full rounded-full bg-foreground" style={{ width: `${r.score}%` }} />
          </span>
        </span>
      ),
    },
    { id: "fill", header: "Fill rate", align: "right", sortValue: (r) => r.m.fillRate, cell: (r) => <span className="tabular">{pct(r.m.fillRate)}</span> },
    { id: "noshow", header: "No show", align: "right", sortValue: (r) => r.m.noShowRate, cell: (r) => <span className="tabular">{pct(r.m.noShowRate, 1)}</span> },
    { id: "compliance", header: "Compliance", align: "right", sortValue: (r) => r.m.compliance, cell: (r) => <span className="tabular">{pct(r.m.compliance)}</span> },
  ]

  const downloadLocations = () =>
    downloadCsv(
      exportName("buyer-spend-ranking"),
      toCsv(
        locations.map((r, i) => ({
          rank: i + 1,
          location: location(r.locationId).name,
          buyer: buyer(r.buyerId).name,
          spend_28_days: r.amount.toFixed(2),
          last_week_vs_normal: changeLabel(r),
          far_above_normal: r.aboveNormal ? "yes" : "no",
          anomalous_invoices: r.anomalous,
        })),
      ),
    )

  const downloadSuppliers = () =>
    downloadCsv(
      exportName("supplier-ranking"),
      toCsv(
        suppliers.map((r, i) => ({
          rank: i + 1,
          supplier: supplier(r.id).name,
          score: r.score,
          fill_rate: pct(r.m.fillRate),
          no_show_rate: pct(r.m.noShowRate, 1),
          compliance: pct(r.m.compliance),
        })),
      ),
    )

  return (
    <>
      <Greeting subtitle={`Compass program · ${BUYERS.length} buyers · ${LOCATIONS.length} locations · ${SUPPLIERS.length} suppliers`} />
      <TodoSection todos={todos} />
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-3">
          <SectionTitle
            title="Buyer spend ranking"
            description="Last 28 days"
            info="Every location ranked by labor spend. The alert marks a location whose last week ran far above its normal week."
            actions={
              <Button variant="ghost" size="sm" className="text-faded" onClick={downloadLocations}>
                <Download /> Download
              </Button>
            }
          />
          <Surface elevated className="overflow-hidden">
            <DataTable rows={locations} columns={locationColumns} getRowId={(r) => r.locationId} onRowClick={(r) => setDrill(r.locationId)} />
          </Surface>
        </section>
        <section className="flex min-w-0 flex-col gap-3">
          <SectionTitle
            title="Supplier ranking"
            description="Last 28 days"
            info="Every supplier ranked by score across all buyers."
            actions={
              <Button variant="ghost" size="sm" className="text-faded" onClick={downloadSuppliers}>
                <Download /> Download
              </Button>
            }
          />
          <Surface elevated className="overflow-hidden">
            <DataTable rows={suppliers} columns={supplierColumns} getRowId={(r) => r.id} onRowClick={(r) => setProfile(r.id)} />
          </Surface>
        </section>
      </div>
      <SupplierProfileDialog supplierId={profile} onOpenChange={(open) => !open && setProfile(undefined)} />
      <LocationDialog rank={locations.find((l) => l.locationId === drill)} onOpenChange={(open) => !open && setDrill(undefined)} />
    </>
  )
}

function LocationDialog({ rank, onOpenChange }: { rank?: LocationRank; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const view = useMemo(() => {
    if (!rank) return undefined
    const from = addDaysISO(todayISO(), -27)
    const totals = new Map<string, number>()
    for (const t of data.timesheets) {
      if (t.locationId !== rank.locationId || t.date < from) continue
      totals.set(t.supplierId, (totals.get(t.supplierId) ?? 0) + t.hours * t.billRate + t.tips)
    }
    const bySupplier = [...totals.entries()].sort((a, b) => b[1] - a[1])
    const flagged = data.invoices.filter((i) => needsReview(data, i) && i.lines.some((l) => l.locationId === rank.locationId))
    return { bySupplier, flagged, max: Math.max(1, ...bySupplier.map(([, v]) => v)) }
  }, [data, rank])

  return (
    <Dialog open={!!rank} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {rank && view && (
          <>
            <DialogHeader>
              <DialogTitle>{location(rank.locationId).name}</DialogTitle>
              <DialogDescription>
                {buyer(rank.buyerId).name} · {moneyWhole(rank.amount)} in the last 28 days
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
              <div className="flex flex-col gap-0.5 bg-card px-3 py-2.5">
                <span className="text-caption-1 text-faded">Normal week</span>
                <span className="text-body-1 font-semibold tabular">{moneyWhole(rank.normal)}</span>
              </div>
              <div className="flex flex-col gap-0.5 bg-card px-3 py-2.5">
                <span className="text-caption-1 text-faded">Last 7 days</span>
                <span className={cn("text-body-1 font-semibold tabular", rank.aboveNormal && "text-critical-fg")}>
                  {moneyWhole(rank.normal * (1 + rank.change))} <span className="text-caption-1 font-medium">{changeLabel(rank)}</span>
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-body-3 font-semibold">Spend by supplier</h3>
              <ul className="flex flex-col gap-2">
                {view.bySupplier.map(([id, amount]) => (
                  <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-2 text-body-3">
                      <SupplierLogo supplierId={id} size="sm" /> {supplier(id).shortName}
                    </span>
                    <span className="text-body-3 font-medium tabular">{moneyWhole(amount)}</span>
                    <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full" style={{ width: `${(amount / view.max) * 100}%`, background: supplier(id).color }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-body-3 font-semibold">Anomalous invoices</h3>
              {view.flagged.length ? (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {view.flagged.map((inv) => (
                    <li key={inv.id}>
                      <Link href={`/invoices/${inv.id}`} className="flex items-center gap-3 px-3 py-2.5 text-body-3 transition-colors hover:bg-hover">
                        <AlertTriangle className="size-4 shrink-0 text-critical-fg" />
                        <span className="font-medium">#{inv.number}</span>
                        <span className="min-w-0 flex-1 truncate text-faded">{supplier(inv.supplierId).shortName}</span>
                        <span className="tabular">{moneyWhole(invoiceTotal(inv))}</span>
                        <span className="w-12 text-right font-medium text-critical-fg tabular">+{pct(invoiceBenchmark(data, inv.id).deltaPct)}</span>
                        <ArrowRight className="size-3.5 text-subtle" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-3 text-faded">None at this location.</p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

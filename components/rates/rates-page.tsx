"use client"

import Link from "next/link"
import { Check, Download, FileUp, MapPin, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { SupplierProfileDialog } from "@/components/home/supplier-profile-dialog"
import { RateDialog } from "@/components/rates/rate-dialog"
import { RateEquation } from "@/components/rates/rate-equation"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatDateShort } from "@/lib/dates"
import { money, pct } from "@/lib/format"
import { formatTimeToFill, metricsFor } from "@/lib/metrics"
import { CITIES, POSITIONS, SUPPLIERS, city, locationsFor, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { RateCard } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ZipCell({ card }: { card: RateCard }) {
  return (
    <Tip
      content={
        <span className="block max-w-[260px]">
          {card.zipsAutoFilled ? `Left blank, so CrUber covers all ${card.zips.length} ${city(card.cityId).name} zip codes. ` : ""}
          {card.zips.slice(0, 18).join(", ")}
          {card.zips.length > 18 ? ` and ${card.zips.length - 18} more` : ""}
        </span>
      }
    >
      <span className="inline-flex items-center gap-1.5">
        <MapPin className="size-3.5 text-subtle" />
        <span className="tabular">{card.zipsAutoFilled ? "All" : card.zips.length}</span>
        {card.zipsAutoFilled && (
          <StatusBadge tone="neutral" size="sm">
            Auto-filled
          </StatusBadge>
        )}
      </span>
    </Tip>
  )
}

/** Each supplier's price list by city. Suppliers upload their own; buyers see bill rates; Compass sees everything side by side. */
export function RatesPage() {
  const { ws } = useWorkspace()
  return ws.kind === "supplier" ? <MyRates /> : <RateComparison />
}

function MyRates() {
  const data = useData()
  const { ws } = useWorkspace()
  const openUpload = useUi((s) => s.openUpload)
  const deleteRateCard = useStore((s) => s.deleteRateCard)
  const sup = supplier(ws.supplierId!)
  const [cityId, setCityId] = useState<string>("all")
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<RateCard | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)

  const cards = useMemo(() => data.rateCards.filter((c) => c.supplierId === sup.id), [data.rateCards, sup.id])
  const rows = useMemo(
    () => cards.filter((c) => (cityId === "all" || c.cityId === cityId) && position(c.positionId).name.toLowerCase().includes(query.toLowerCase())),
    [cards, cityId, query],
  )

  const columns: Column<RateCard>[] = [
    { id: "city", header: "City", sortValue: (c) => `${city(c.cityId).name}${position(c.positionId).name}`, cell: (c) => `${city(c.cityId).name}, ${city(c.cityId).state}` },
    { id: "zips", header: "Zip codes", info: "Optional. Leave blank and CrUber fills in every zip code in the city.", cell: (c) => <ZipCell card={c} /> },
    { id: "position", header: "Position", sortValue: (c) => position(c.positionId).name, cell: (c) => <span className="font-medium">{position(c.positionId).name}</span> },
    { id: "pay", header: "Pay rate", info: "What the Pro earns per hour.", align: "right", sortValue: (c) => c.proRate, cell: (c) => <span className="tabular">{money(c.proRate)}</span> },
    {
      id: "bill",
      header: "Bill rate",
      info: "What Compass pays you per hour. Invoices use this rate.",
      align: "right",
      sortValue: (c) => c.billRate,
      cell: (c) => <span className="font-semibold tabular">{money(c.billRate)}</span>,
    },
    {
      id: "markup",
      header: "Markup",
      info: "What you keep: bill rate minus pay rate.",
      align: "right",
      sortValue: (c) => c.billRate - c.proRate,
      cell: (c) => (
        <Tip content={`${c.markupPct}% of the pay rate`}>
          <span className="tabular">{money(c.billRate - c.proRate)}</span>
        </Tip>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      sortValue: (c) => c.updatedAt,
      cell: (c) => (
        <span className="flex flex-col">
          <span>{formatDateShort(c.updatedAt.slice(0, 10))}</span>
          <span className="text-caption-1 text-faded">{c.source === "api" ? "Synced by API" : c.source === "upload" ? "CSV upload" : "Edited in CrUber"}</span>
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (c) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Rate actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => (setEditing(c), setDialogOpen(true))}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => (deleteRateCard(c.id), toast(`${position(c.positionId).name} rate removed`))}>
              <Trash2 /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const exportCsv = () =>
    downloadCsv(
      exportName("my-rates"),
      toCsv(
        rows.map((c) => ({
          city: city(c.cityId).name,
          zip_codes: c.zipsAutoFilled ? "" : c.zips.join(";"),
          position: position(c.positionId).name,
          pay_rate: c.proRate.toFixed(2),
          bill_rate: c.billRate.toFixed(2),
          markup: (c.billRate - c.proRate).toFixed(2),
        })),
        ["city", "zip_codes", "position", "pay_rate", "bill_rate", "markup"],
      ),
    )

  return (
    <>
      <PageHeader
        className="pt-4"
        title="My Rates"
        description="Your price list by city. Invoices charge your bill rate for the shift's city, and buyers compare it before approving you."
        actions={
          <>
            <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3 text-faded" onClick={exportCsv}>
              <Download className="size-4" /> Download
            </Button>
            <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => (setEditing(undefined), setDialogOpen(true))}>
              <Plus className="size-4" /> Add rate
            </Button>
            <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => openUpload("rates")}>
              <FileUp className="size-4" /> Upload CSV
            </Button>
          </>
        }
      />
      <RateEquation example={{ pro: 20, markup: sup.profile.markupPct }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          value={cityId}
          onChange={setCityId}
          items={[
            { value: "all", label: "All cities", count: cards.length },
            ...sup.cityIds.map((id) => ({ value: id, label: `${city(id).name}, ${city(id).state}`, count: cards.filter((c) => c.cityId === id).length })),
          ]}
        />
        <SearchInput value={query} onChange={setQuery} placeholder="Search positions" className="w-56" />
      </div>
      <Surface elevated className="overflow-hidden">
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(c) => c.id}
          initialSort={{ id: "city", dir: "asc" }}
          pageSize={30}
          empty={<EmptyState icon={MapPin} title="No rates here yet" description="Add a rate or upload a CSV to start receiving shifts in this city." compact />}
        />
      </Surface>
      <RateDialog open={dialogOpen} onOpenChange={setDialogOpen} supplierId={sup.id} card={editing} />
    </>
  )
}

type Metric = "bill" | "pay" | "markup"

function RateComparison() {
  const data = useData()
  const { ws } = useWorkspace()
  const isBuyer = ws.kind === "buyer"
  const cities = useMemo(() => {
    if (!isBuyer) return CITIES
    const ids = new Set(locationsFor(ws.buyerId).map((l) => l.cityId))
    return CITIES.filter((c) => ids.has(c.id))
  }, [isBuyer, ws.buyerId])
  const [cityId, setCityId] = useState(cities[0].id)
  const [metric, setMetric] = useState<Metric>("bill")
  const [profile, setProfile] = useState<string>()
  const suppliers = SUPPLIERS.filter((s) => s.cityIds.includes(cityId))
  const approved = isBuyer ? (data.approvals[ws.buyerId!] ?? []) : []
  const shown: Metric = isBuyer ? "bill" : metric

  const matrix = useMemo(
    () =>
      POSITIONS.map((p) => {
        const cards = suppliers.map((s) => data.rateCards.find((c) => c.supplierId === s.id && c.cityId === cityId && c.positionId === p.id && c.status === "active"))
        const live = cards.filter((c): c is RateCard => !!c)
        const low = live.length ? Math.min(...live.map((c) => c.billRate)) : 0
        return { position: p, cards, low }
      }).filter((row) => row.cards.some(Boolean)),
    [data.rateCards, suppliers, cityId],
  )

  const value = (c: RateCard) => (shown === "bill" ? money(c.billRate) : shown === "pay" ? money(c.proRate) : money(c.billRate - c.proRate))

  const exportCsv = () =>
    downloadCsv(
      exportName(`supplier-rates-${city(cityId).name.toLowerCase()}`),
      toCsv(
        matrix.flatMap((row) =>
          row.cards.flatMap((c, i) =>
            c
              ? [
                  isBuyer
                    ? { city: city(cityId).name, position: row.position.name, supplier: suppliers[i].name, bill_rate: c.billRate.toFixed(2) }
                    : {
                        city: city(cityId).name,
                        position: row.position.name,
                        supplier: suppliers[i].name,
                        pay_rate: c.proRate.toFixed(2),
                        bill_rate: c.billRate.toFixed(2),
                        markup: (c.billRate - c.proRate).toFixed(2),
                      },
                ]
              : [],
          ),
        ),
      ),
    )

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Supplier Rates"
        description={
          isBuyer
            ? "What each supplier charges per hour in your cities. Use it to decide which suppliers to approve on your Dashboard."
            : "Every supplier's rates by city, side by side. Suppliers upload their own; invoices use the bill rate for the shift's city."
        }
        actions={
          <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3 text-faded" onClick={exportCsv}>
            <Download className="size-4" /> Download
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs value={cityId} onChange={setCityId} items={cities.map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))} />
        {!isBuyer && (
          <PillTabs
            size="sm"
            value={metric}
            onChange={setMetric}
            items={[
              { value: "bill", label: "Bill rate", tooltip: "What Compass pays per hour" },
              { value: "pay", label: "Pay rate", tooltip: "What the Pro earns per hour" },
              { value: "markup", label: "Markup", tooltip: "What the supplier keeps: bill rate minus pay rate" },
            ]}
          />
        )}
      </div>
      <Surface elevated className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] border-collapse text-left text-body-3">
            <thead>
              <tr className="border-b border-border bg-page-faded">
                <th className="sticky left-0 z-10 bg-page-faded px-4 py-3 text-caption-1 font-medium text-faded">Position</th>
                {suppliers.map((s) => {
                  const m = metricsFor(data, s.id, ws.buyerId)
                  return (
                    <th key={s.id} className="px-4 py-3">
                      <button type="button" onClick={() => setProfile(s.id)} className="flex items-center gap-2.5 text-left">
                        <SupplierLogo supplierId={s.id} size="md" />
                        <span className="flex flex-col">
                          <span className="flex items-center gap-1.5 text-body-3 font-bold hover:text-primary">
                            {s.shortName}
                            {isBuyer && approved.includes(s.id) && (
                              <Tip content="Approved: gets your new shifts">
                                <Check className="size-3.5 text-positive-fg" />
                              </Tip>
                            )}
                          </span>
                          <span className="text-caption-1 font-normal text-faded">
                            {pct(m.fillRate)} fill · {formatTimeToFill(m.hoursToFill)}
                          </span>
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={`${cityId}-${row.position.id}`} className="border-b border-border/70 transition-colors duration-100 last:border-0 hover:bg-hover/60">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3">
                    <span className="flex flex-col">
                      <span className="font-semibold">{row.position.name}</span>
                      <span className="text-caption-1 text-faded">{row.position.category}</span>
                    </span>
                  </td>
                  {row.cards.map((c, i) => {
                    const s = suppliers[i]
                    if (!c)
                      return (
                        <td key={s.id} className="px-4 py-3">
                          <Tip content={`${s.shortName} doesn't staff ${row.position.name} in ${city(cityId).name}`}>
                            <span className="text-subtle">—</span>
                          </Tip>
                        </td>
                      )
                    const lowest = c.billRate === row.low
                    return (
                      <td key={s.id} className="px-4 py-2.5">
                        <Tip
                          content={
                            isBuyer
                              ? `${s.shortName} · ${row.position.name}: ${money(c.billRate)}/hr`
                              : `${s.shortName} · ${row.position.name}: pay rate ${money(c.proRate)} + markup ${money(c.billRate - c.proRate)} = ${money(c.billRate)}/hr`
                          }
                        >
                          <span className={cn("inline-flex min-w-28 flex-col rounded-lg px-2.5 py-1.5", lowest && shown === "bill" && "bg-positive-faded ring-1 ring-positive-border")}>
                            <span className="flex items-center gap-1.5 font-bold tabular">
                              {value(c)}
                              {lowest && shown === "bill" && <Check className="size-3.5 text-positive" />}
                            </span>
                            <span className={cn("text-caption-1 tabular", lowest && shown === "bill" ? "text-positive-fg" : "text-faded")}>
                              {shown === "bill" ? (lowest ? "Lowest" : `+${money(c.billRate - row.low)}`) : shown === "markup" ? `${c.markupPct}%` : `${money(c.billRate)} bill`}
                            </span>
                          </span>
                        </Tip>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>
      {isBuyer && (
        <p className="flex flex-wrap items-center gap-1.5 text-caption-1 text-faded">
          The lowest rate isn&apos;t always the best value
          <InfoTip>Click a supplier to see its fill rate, no-shows and compliance at your locations.</InfoTip>
          <Link href="/" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
            Approve suppliers on your Dashboard
          </Link>
        </p>
      )}
      <SupplierProfileDialog supplierId={profile} onOpenChange={(open) => !open && setProfile(undefined)} />
    </>
  )
}

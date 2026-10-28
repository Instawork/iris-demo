"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Check, ChevronDown, Download, FileUp, MapPin, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { SearchInput } from "@/components/common/filters"
import { Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { RateChanges } from "@/components/rates/rate-changes"
import { RateDialog } from "@/components/rates/rate-dialog"
import { RateEquation } from "@/components/rates/rate-equation"
import { RateReviews } from "@/components/rates/rate-reviews"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatDateShort } from "@/lib/dates"
import { money, pct } from "@/lib/format"
import { formatTimeToFill, metricsFor } from "@/lib/metrics"
import { CITIES, POSITIONS, PROGRAM, city, locationsFor, policyFor, position, supplier } from "@/lib/reference"
import { joinNames, notifiedSuppliers, pickedOffer, useStore } from "@/lib/store"
import type { RateCard } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ZipCell({ card }: { card: RateCard }) {
  return (
    <Tip
      content={
        <span className="block max-w-[260px]">
          {card.zipsAutoFilled ? `Left blank, so Iris covers all ${card.zips.length} ${city(card.cityId).name} zip codes. ` : ""}
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
  const reviews = useMemo(() => cards.filter((c) => c.rateReview?.status === "requested"), [cards])
  const rows = useMemo(
    () => cards.filter((c) => (cityId === "all" || c.cityId === cityId) && position(c.positionId).name.toLowerCase().includes(query.toLowerCase())),
    [cards, cityId, query],
  )

  const columns: Column<RateCard>[] = [
    { id: "city", header: "City", sortValue: (c) => `${city(c.cityId).name}${position(c.positionId).name}`, cell: (c) => `${city(c.cityId).name}, ${city(c.cityId).state}` },
    { id: "zips", header: "Zip codes", info: "Optional. Leave blank and Iris fills in every zip code in the city.", cell: (c) => <ZipCell card={c} /> },
    { id: "position", header: "Position", sortValue: (c) => position(c.positionId).name, cell: (c) => <span className="font-medium">{position(c.positionId).name}</span> },
    { id: "pay", header: "Pay rate", info: "What the worker earns per hour.", align: "right", sortValue: (c) => c.proRate, cell: (c) => <span className="tabular">{money(c.proRate)}</span> },
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
      info: "What you add on top of the pay rate.",
      align: "right",
      sortValue: (c) => c.markupPct,
      cell: (c) => <span className="tabular">{c.markupPct}%</span>,
    },
    {
      id: "updated",
      header: "Updated",
      sortValue: (c) => c.updatedAt,
      cell: (c) => (
        <span className="flex flex-col">
          <span>{formatDateShort(c.updatedAt.slice(0, 10))}</span>
          <span className="text-caption-1 text-faded">{c.source === "api" ? "Synced by API" : c.source === "upload" ? "CSV upload" : "Edited in Iris"}</span>
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
          markup_pct: String(c.markupPct),
        })),
        ["city", "zip_codes", "position", "pay_rate", "bill_rate", "markup_pct"],
      ),
    )

  return (
    <>
      <PageHeader
        className="pt-4"
        title="My Rates"
        description="Your price list by city. Invoices use your bill rate for the shift's city."
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
      {reviews.length > 0 && <RateReviews cards={reviews} />}
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
      <RateChanges />
      <RateDialog open={dialogOpen} onOpenChange={setDialogOpen} supplierId={sup.id} card={editing} />
    </>
  )
}

type Metric = "bill" | "pay" | "markup"

/**
 * Role first, so it holds up with any number of agencies: each role shows who sees its shifts first and the spread of
 * rates, and opens into every agency's offer, cheapest first.
 */
function RateComparison() {
  const data = useData()
  const { ws } = useWorkspace()
  const params = useSearchParams()
  const pickOffer = useStore((s) => s.pickOffer)
  const isBuyer = ws.kind === "buyer"
  const cities = useMemo(() => {
    if (!isBuyer) return CITIES
    const ids = new Set(locationsFor(ws.buyerId).map((l) => l.cityId))
    return CITIES.filter((c) => ids.has(c.id))
  }, [isBuyer, ws.buyerId])
  const [cityId, setCityId] = useState(cities[0].id)
  const [metric, setMetric] = useState<Metric>("bill")
  const [query, setQuery] = useState("")
  const [openRoles, setOpenRoles] = useState<Set<string>>(() => new Set(params.get("role") ? [params.get("role")!] : []))
  const approved = useMemo(() => (isBuyer ? (data.approvals[ws.buyerId!] ?? []) : []), [data.approvals, isBuyer, ws.buyerId])
  const shown: Metric = isBuyer ? "bill" : metric
  const gap = isBuyer ? policyFor(ws.buyerId!).tierGapHours : PROGRAM.cascadeHoursBefore

  const roles = useMemo(
    () =>
      POSITIONS.map((p) => {
        const cards = data.rateCards
          .filter((c) => c.cityId === cityId && c.positionId === p.id && c.status === "active")
          .sort((a, b) => a.billRate - b.billRate || supplier(a.supplierId).shortName.localeCompare(supplier(b.supplierId).shortName))
        const live = isBuyer ? cards.filter((c) => approved.includes(c.supplierId)) : cards
        const order = isBuyer ? notifiedSuppliers(data, ws.buyerId!, cityId, p.id) : []
        const picked = isBuyer ? pickedOffer(data, ws.buyerId!, cityId, p.id) : undefined
        const first = order[0]?.supplier.id
        return {
          position: p,
          cards,
          live,
          low: live.length ? live[0].billRate : 0,
          high: live.length ? live[live.length - 1].billRate : 0,
          first,
          picked: first && first === picked ? picked : undefined,
          rank: new Map(order.map((n, i) => [n.supplier.id, i])),
        }
      }).filter((row) => row.cards.length && row.position.name.toLowerCase().includes(query.trim().toLowerCase())),
    [data, cityId, isBuyer, ws.buyerId, approved, query],
  )

  const toggle = (id: string) =>
    setOpenRoles((open) => {
      const next = new Set(open)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const pick = (row: (typeof roles)[number], supplierId: string | null) => {
    void pickOffer(ws.buyerId!, cityId, row.position.id, supplierId).then(() => {
      const order = notifiedSuppliers(useStore.getState().data, ws.buyerId!, cityId, row.position.id)
      const rest = order.slice(1).map((n) => n.supplier.shortName)
      toast.success(`${order[0]?.supplier.shortName} sees new ${row.position.name} shifts first`, {
        description: rest.length ? `Then ${joinNames(rest)}, by rate, ${gap} hours apart while spots are open.` : undefined,
      })
    })
  }

  const value = (c: RateCard) => (shown === "bill" ? money(c.billRate) : shown === "pay" ? money(c.proRate) : `${c.markupPct}%`)

  const exportCsv = () =>
    downloadCsv(
      exportName(`agency-rates-${city(cityId).name.toLowerCase()}`),
      toCsv(
        roles.flatMap((row) =>
          row.cards.map((c) =>
            isBuyer
              ? { city: city(cityId).name, position: row.position.name, agency: supplier(c.supplierId).name, bill_rate: c.billRate.toFixed(2) }
              : {
                  city: city(cityId).name,
                  position: row.position.name,
                  agency: supplier(c.supplierId).name,
                  pay_rate: c.proRate.toFixed(2),
                  bill_rate: c.billRate.toFixed(2),
                  markup_pct: String(c.markupPct),
                },
          ),
        ),
      ),
    )

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Rate Cards"
        description={isBuyer ? "Each role's rates across your agencies. Pick who sees a role's shifts first." : "Every agency's rates by role and city."}
        actions={
          <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3 text-faded" onClick={exportCsv}>
            <Download className="size-4" /> Download
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-3">
          {cities.length > 1 ? (
            <PillTabs value={cityId} onChange={setCityId} items={cities.map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))} />
          ) : (
            <span className="text-body-2 font-semibold">
              {city(cityId).name}, {city(cityId).state}
            </span>
          )}
          {!isBuyer && (
            <PillTabs
              size="sm"
              value={metric}
              onChange={setMetric}
              items={[
                { value: "bill", label: "Bill rate", tooltip: "What Compass pays per hour" },
                { value: "pay", label: "Pay rate", tooltip: "What the worker earns per hour" },
                { value: "markup", label: "Markup", tooltip: "What the agency adds on top of the pay rate" },
              ]}
            />
          )}
        </span>
        <SearchInput value={query} onChange={setQuery} placeholder="Search roles" className="w-56" />
      </div>
      <Surface elevated className="overflow-hidden" data-tour="offers">
        <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(130px,1fr)_28px] items-center gap-4 border-b border-border bg-page-faded px-4 py-2.5 text-caption-1 font-medium text-faded">
          <span>Role</span>
          <span>{isBuyer ? "Sees it first" : "Lowest"}</span>
          <span className="text-right">{isBuyer ? "Best rate" : "Lowest bill rate"}</span>
          <span className="text-right">Range</span>
          <span />
        </div>
        {roles.map((row, index) => {
          const open = openRoles.has(row.position.id)
          const lead = row.first ?? row.live[0]?.supplierId
          return (
            <Fragment key={`${cityId}-${row.position.id}`}>
              {row.position.category !== roles[index - 1]?.position.category && (
                <div className="border-b border-border/70 bg-page-faded/60 px-4 py-1.5 text-caption-1 font-semibold text-faded">{row.position.category}</div>
              )}
              <div data-position={row.position.id} className="border-b border-border/70 last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(row.position.id)}
                  aria-expanded={open}
                  className="grid w-full grid-cols-[minmax(140px,1.2fr)_minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(130px,1fr)_28px] items-center gap-4 px-4 py-3 text-left text-body-3 transition-colors hover:bg-hover/60"
                >
                  <span className="font-semibold">{row.position.name}</span>
                  {lead ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <SupplierLogo supplierId={lead} size="sm" />
                      <span className="truncate font-medium">{supplier(lead).shortName}</span>
                      {isBuyer && (
                        <StatusBadge tone="neutral" size="sm">
                          {row.picked ? "Your pick" : "Lowest rate"}
                        </StatusBadge>
                      )}
                    </span>
                  ) : (
                    <span className="text-faded">No approved agency</span>
                  )}
                  <span className="text-right font-semibold tabular">{row.live.length ? money(row.low) : "—"}</span>
                  <span className="text-right text-faded tabular">
                    {row.live.length > 1 ? `${money(row.low)}–${money(row.high)}` : row.live.length ? "One offer" : "—"}
                    <span className="block text-caption-1">{row.cards.length === 1 ? "1 agency" : `${row.cards.length} agencies`}</span>
                  </span>
                  <ChevronDown className={cn("size-4 justify-self-end text-subtle transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                  <ol className="flex flex-col gap-1 bg-page-faded/50 px-4 pt-1 pb-3" data-tour="role-offers">
                    {row.cards.map((c) => {
                      const s = supplier(c.supplierId)
                      const m = metricsFor(data, s.id, ws.buyerId)
                      const approvedHere = !isBuyer || approved.includes(s.id)
                      const first = row.first === s.id
                      const rank = row.rank.get(s.id)
                      return (
                        <li key={c.id} className={cn("flex items-center gap-3 rounded-lg border bg-card px-3 py-2", first ? "border-primary/40 ring-1 ring-primary/30" : "border-border", !approvedHere && "opacity-60")}>
                          <SupplierLogo supplierId={s.id} size="md" />
                          <Link href={`/agencies/${s.id}`} className="flex min-w-0 flex-1 flex-col hover:underline">
                            <span className="truncate font-semibold">{s.name}</span>
                            <span className="truncate text-caption-1 text-faded">
                              {m.slotsFilled ? `${pct(m.fillRate)} fill · fills in about ${formatTimeToFill(m.hoursToFill)}` : "No shifts with you yet"}
                            </span>
                          </Link>
                          <span className="flex flex-col items-end">
                            <span className="font-semibold tabular">
                              {value(c)}
                              {shown !== "markup" && <span className="font-normal text-faded">/hr</span>}
                            </span>
                            <span className={cn("text-caption-1 tabular", c.billRate === row.low && approvedHere ? "text-positive-fg" : "text-faded")}>
                              {shown === "bill" ? (c.billRate === row.low && approvedHere ? "Lowest" : approvedHere ? `+${money(c.billRate - row.low)}` : "") : shown === "pay" ? `${money(c.billRate)} bill` : `${money(c.billRate)} bill`}
                            </span>
                          </span>
                          {isBuyer && (
                            <span className="w-32 shrink-0 text-right">
                              {!approvedHere ? (
                                <Tip content={`Approve ${s.shortName} on its page to send it shifts`}>
                                  <span className="text-caption-1 text-faded">Not approved</span>
                                </Tip>
                              ) : first ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-tour="offer"
                                  data-supplier={s.id}
                                  aria-pressed
                                  className="text-primary"
                                  onClick={() => row.picked && pick(row, null)}
                                  title={row.picked ? "Go back to lowest rate first" : undefined}
                                >
                                  <Check /> {row.picked ? "Your pick" : "First"}
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" data-tour="offer" data-supplier={s.id} aria-pressed={false} onClick={() => pick(row, s.id)}>
                                  Send here first
                                </Button>
                              )}
                              {approvedHere && !first && rank !== undefined && <span className="mt-0.5 block text-caption-2 text-faded">Now +{rank * gap}h</span>}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            </Fragment>
          )
        })}
        {!roles.length && <EmptyState icon={MapPin} title="No rates match" description="Try another role or city." compact />}
      </Surface>
      <RateChanges />
    </>
  )
}

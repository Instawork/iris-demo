"use client"

import { Download, History } from "lucide-react"
import { useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { MultiSelectFilter } from "@/components/common/filters"
import { SectionTitle } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatTimestamp } from "@/lib/dates"
import { money } from "@/lib/format"
import { CITIES, PROGRAM, SUPPLIERS, city, citiesForBuyer, findSupplier, position } from "@/lib/reference"
import type { RateChange } from "@/lib/types"

/**
 * The rate log as Compass audits it: every change to every rate card, newest first, with the rate before and after,
 * who made it and how it arrived. A buyer sees the bill rates of agencies in its cities; an agency sees its own.
 */

const SOURCE: Record<RateChange["source"], string> = {
  manual: "Typed in",
  upload: "CSV upload",
  api: "Agency's system",
  onboarding: "Onboarding",
  review: "Rate review",
  award: "Procurement",
}

const delta = (c: RateChange) => (c.from && c.to && c.from.billRate ? c.to.billRate / c.from.billRate - 1 : undefined)

export function RateChanges({ supplierId }: { supplierId?: string }) {
  const data = useData()
  const { ws } = useWorkspace()
  const isBuyer = ws.kind === "buyer"
  const oneAgency = ws.kind === "supplier" || !!supplierId
  const [agencies, setAgencies] = useState<string[]>([])
  const [markets, setMarkets] = useState<string[]>([])
  const cities = isBuyer ? citiesForBuyer(ws.buyerId).map((c) => c.id) : CITIES.map((c) => c.id)
  const scoped = data.rateLog.filter((c) =>
    ws.kind === "supplier" ? c.supplierId === ws.supplierId : cities.includes(c.cityId) && (!supplierId || c.supplierId === supplierId),
  )
  const rows = scoped.filter((c) => (!agencies.length || agencies.includes(c.supplierId)) && (!markets.length || markets.includes(c.cityId)))

  const columns: Column<RateChange>[] = [
    {
      id: "at",
      header: "When",
      sortValue: (c) => c.at,
      cell: (c) => <span className="whitespace-nowrap tabular">{formatTimestamp(c.at)}</span>,
    },
    ...(oneAgency
      ? []
      : [
          {
            id: "agency",
            header: "Agency",
            sortValue: (c: RateChange) => findSupplier(c.supplierId)?.shortName ?? "",
            cell: (c: RateChange) => (
              <span className="flex items-center gap-2">
                <SupplierLogo supplierId={c.supplierId} size="sm" />
                {findSupplier(c.supplierId)?.shortName ?? c.supplierId}
              </span>
            ),
          } satisfies Column<RateChange>,
        ]),
    {
      id: "rate",
      header: "Rate",
      sortValue: (c) => `${position(c.positionId).name} ${city(c.cityId).name}`,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{position(c.positionId).name}</span>
          <span className="text-caption-1 text-faded">{city(c.cityId).name}</span>
        </span>
      ),
    },
    {
      id: "change",
      header: "Bill rate",
      info: "What Compass pays per hour.",
      cell: (c) => {
        const d = delta(c)
        return (
          <span className="flex flex-col">
            <span className="flex items-center gap-1.5 tabular">
              {c.action === "added" && <span className="font-semibold">Set at {money(c.to!.billRate)}</span>}
              {c.action === "removed" && <span className="text-faded">Removed, was {money(c.from!.billRate)}</span>}
              {c.action === "changed" && (
                <>
                  <span className="text-faded line-through decoration-1">{money(c.from!.billRate)}</span>
                  <span className="font-semibold">{money(c.to!.billRate)}</span>
                  {d !== undefined && Math.abs(d) >= 0.0005 && (
                    <span className={d > 0.1 ? "text-critical-fg" : d < 0 ? "text-positive-fg" : "text-faded"}>
                      {d > 0 ? "+" : "−"}
                      {Math.abs(d * 100).toFixed(1)}%
                    </span>
                  )}
                </>
              )}
            </span>
            {c.note && c.source !== "award" && <span className="max-w-72 text-caption-1 whitespace-normal text-faded">“{c.note}”</span>}
          </span>
        )
      },
    },
    ...(isBuyer
      ? []
      : [
          {
            id: "terms",
            header: "Pay · markup",
            cell: (c: RateChange) => {
              const v = c.to ?? c.from!
              const fromTerms = c.action === "changed" && c.from && (c.from.proRate !== v.proRate || c.from.markupPct !== v.markupPct)
              return (
                <span className="flex flex-col tabular">
                  <span>
                    {money(v.proRate)} · {v.markupPct}%
                  </span>
                  {fromTerms && (
                    <span className="text-caption-1 text-faded">
                      was {money(c.from!.proRate)} · {c.from!.markupPct}%
                    </span>
                  )}
                </span>
              )
            },
          } satisfies Column<RateChange>,
        ]),
    {
      id: "source",
      header: "How",
      sortValue: (c) => SOURCE[c.source],
      cell: (c) => (
        <span className="flex flex-col">
          <span>{SOURCE[c.source]}</span>
          {c.uploadId && <span className="font-mono text-caption-1 text-faded">{c.uploadId.toUpperCase()}</span>}
          {c.source === "award" && c.note && <span className="font-mono text-caption-1 text-faded">{c.note}</span>}
        </span>
      ),
    },
    { id: "by", header: "By", sortValue: (c) => c.by, cell: (c) => c.by },
    {
      id: "flags",
      header: "Iris check",
      cell: (c) => {
        const d = delta(c)
        if (c.to && c.to.markupPct > PROGRAM.maxMarkupPct)
          return (
            <StatusBadge tone="critical" size="sm">
              Over the {PROGRAM.maxMarkupPct}% cap
            </StatusBadge>
          )
        if (d !== undefined && d > 0.1)
          return (
            <StatusBadge tone="warning" size="sm">
              Up {Math.round(d * 100)}% at once
            </StatusBadge>
          )
        return <span className="text-caption-1 text-faded">Within terms</span>
      },
    },
  ]

  const download = () =>
    downloadCsv(
      exportName(supplierId ? `rate-changes-${supplierId}` : "rate-changes"),
      toCsv(
        rows.map((c) => ({
          when: c.at,
          agency: findSupplier(c.supplierId)?.name ?? c.supplierId,
          position: position(c.positionId).name,
          market: city(c.cityId).name,
          change: c.action,
          bill_rate_before: c.from?.billRate.toFixed(2) ?? "",
          bill_rate_after: c.to?.billRate.toFixed(2) ?? "",
          ...(isBuyer
            ? {}
            : {
                pay_rate_before: c.from?.proRate.toFixed(2) ?? "",
                pay_rate_after: c.to?.proRate.toFixed(2) ?? "",
                markup_before: c.from?.markupPct ?? "",
                markup_after: c.to?.markupPct ?? "",
              }),
          how: SOURCE[c.source],
          upload: c.uploadId?.toUpperCase() ?? "",
          by: c.by,
          note: c.note ?? "",
        })),
      ),
    )

  const agencyOptions = SUPPLIERS.filter((s) => scoped.some((c) => c.supplierId === s.id)).map((s) => ({ value: s.id, label: s.shortName }))
  const marketOptions = CITIES.filter((c) => scoped.some((x) => x.cityId === c.id)).map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))

  return (
    <section id="changes" className="flex scroll-mt-20 flex-col gap-3" data-tour="rate-changes">
      <SectionTitle
        title="Rate changes"
        description={`${scoped.length} changes, newest first`}
        info="Every change to a rate card is kept with the rate before and after, who made it and how it came in, even if the card is later removed."
        actions={
          <Button variant="ghost" size="sm" className="text-faded" onClick={download}>
            <Download /> Download
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {!oneAgency && <MultiSelectFilter label="Agency" options={agencyOptions} value={agencies} onChange={setAgencies} />}
        <MultiSelectFilter label="Market" options={marketOptions} value={markets} onChange={setMarkets} />
      </div>
      <Surface elevated className="overflow-hidden">
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(c) => c.id}
          pageSize={15}
          dense
          empty={<EmptyState icon={History} title="No rate changes" description="Changes show up here the moment a rate card is edited, uploaded or answered." compact />}
        />
      </Surface>
    </section>
  )
}

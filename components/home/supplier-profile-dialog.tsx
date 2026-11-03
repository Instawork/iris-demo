"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { PerformanceBadge } from "@/components/agencies/performance-badge"
import { SupplierLogo } from "@/components/brand/org-avatar"
import { InfoTip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useData, useWorkspace } from "@/hooks/use-app"
import { money, pct } from "@/lib/format"
import { agencyPerformance, formatTimeToFill, metricsFor } from "@/lib/metrics"
import { BUYERS, POSITIONS, city, locationsFor, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"

/** A supplier's profile: score, performance and rates. Buyers also decide here whether it gets their new shifts. */
export function SupplierProfileDialog({ supplierId, onOpenChange }: { supplierId?: string; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!supplierId} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">{supplierId && <ProfileBody supplierId={supplierId} />}</DialogContent>
    </Dialog>
  )
}

function ProfileBody({ supplierId }: { supplierId: string }) {
  const data = useData()
  const { ws } = useWorkspace()
  const setApproval = useStore((s) => s.setSupplierApproval)
  const sup = supplier(supplierId)
  const buyerId = ws.kind === "buyer" ? ws.buyerId : undefined
  const cities = useMemo(() => {
    const ids = buyerId ? [...new Set(locationsFor(buyerId).map((l) => l.cityId))] : sup.cityIds
    return ids.filter((id) => sup.cityIds.includes(id))
  }, [buyerId, sup.cityIds])
  const [cityId, setCityId] = useState(cities[0] ?? "")
  const m = metricsFor(data, sup.id, buyerId)
  const performance = agencyPerformance(data, sup.id)
  const approved = buyerId ? (data.approvals[buyerId] ?? []).includes(sup.id) : false
  const approvedBy = BUYERS.filter((b) => (data.approvals[b.id] ?? []).includes(sup.id))
  const cards = data.rateCards
    .filter((c) => c.supplierId === sup.id && c.cityId === cityId && c.status === "active")
    .sort((a, b) => POSITIONS.findIndex((p) => p.id === a.positionId) - POSITIONS.findIndex((p) => p.id === b.positionId))
  const showCost = ws.kind !== "buyer"

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 border-b border-border px-6 py-5 text-left">
        <SupplierLogo supplierId={sup.id} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DialogTitle className="flex items-center gap-2">
            {sup.name}
            <PerformanceBadge performance={performance} />
          </DialogTitle>
          <DialogDescription className="truncate">{sup.tagline}</DialogDescription>
        </div>
      </DialogHeader>

      <div className="flex max-h-[70svh] flex-col gap-5 overflow-y-auto px-6 py-5 scrollbar-thin">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          {[
            { label: "Fill rate", value: pct(m.fillRate), info: "Share of spots filled on shifts that already happened." },
            { label: "Time to fill", value: formatTimeToFill(m.hoursToFill), info: "Median time from a shift going out to a worker confirming." },
            { label: "No-show rate", value: pct(m.noShowRate), info: "Share of confirmed workers who didn't show up." },
            { label: "Compliance", value: pct(m.compliance), info: "Share of active workers with every required document." },
          ].map((x) => (
            <div key={x.label} className="flex flex-col gap-0.5 bg-card px-3 py-2.5">
              <span className="flex items-center gap-1 text-caption-1 text-faded">
                {x.label} <InfoTip>{x.info}</InfoTip>
              </span>
              <span className="text-body-1 font-semibold tabular">{x.value}</span>
            </div>
          ))}
        </div>
        <p className="-mt-3 text-caption-1 text-subtle">{buyerId ? "From shifts it filled at your locations, last 28 days" : "Across every buyer, last 28 days"}</p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-1.5 text-body-3 font-semibold">
              Rates <InfoTip>{showCost ? "Pay rate is what the worker earns. Markup is what the agency adds. Bill rate is what Compass pays." : "What you pay per hour for each role."}</InfoTip>
            </h3>
            {cities.length > 1 && (
              <PillTabs size="sm" value={cityId} onChange={setCityId} items={cities.map((id) => ({ value: id, label: city(id).name }))} />
            )}
          </div>
          {cards.length ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-body-3">
                <thead className="bg-tint-faded text-caption-1 text-faded">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Position</th>
                    {showCost && <th className="px-3 py-2 text-right font-medium">Pay rate</th>}
                    {showCost && <th className="px-3 py-2 text-right font-medium">Markup</th>}
                    <th className="px-3 py-2 text-right font-medium">Bill rate</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr key={c.id} className="border-t border-border/80">
                      <td className="px-3 py-2">{POSITIONS.find((p) => p.id === c.positionId)?.name}</td>
                      {showCost && <td className="px-3 py-2 text-right tabular text-faded">{money(c.proRate)}</td>}
                      {showCost && <td className="px-3 py-2 text-right tabular text-faded">{c.markupPct}%</td>}
                      <td className="px-3 py-2 text-right font-medium tabular">{money(c.billRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-body-3 text-faded">No rates in {city(cityId).name} yet.</p>
          )}
        </div>

        {buyerId ? (
          <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3.5 py-3">
            <span className="flex flex-col">
              <span className="text-body-3 font-medium">Send my new shifts to {sup.shortName}</span>
              <span className="text-caption-1 text-faded">Approved agencies are notified when you post a shift.</span>
            </span>
            <Switch
              checked={approved}
              onCheckedChange={(on) => {
                setApproval(buyerId, sup.id, on)
                toast.success(on ? `${sup.shortName} will get your new shifts` : `${sup.shortName} won't get your new shifts`)
              }}
            />
          </label>
        ) : (
          <p className="text-body-3 text-faded">
            Approved by {approvedBy.length ? approvedBy.map((b) => b.name).join(" and ") : "no buyers yet"}.
          </p>
        )}
      </div>

      <div className="flex justify-end border-t border-border px-6 py-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/rates">
            Compare all rates <ArrowRight />
          </Link>
        </Button>
      </div>
    </>
  )
}

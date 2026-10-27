"use client"

import Link from "next/link"
import { ArrowRight, Building2, Check, FileSpreadsheet } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { RateChanges } from "@/components/rates/rate-changes"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useData, useWorkspace } from "@/hooks/use-app"
import { readiness, summaryOf } from "@/lib/compliance"
import { addDaysISO, daysFromToday, formatDateShort, todayISO } from "@/lib/dates"
import { money, pct, plural } from "@/lib/format"
import { complianceScore, formatTimeToFill, metricsFor, supplierScore } from "@/lib/metrics"
import { BUYERS, POSITIONS, PROGRAM, SUPPLIERS, city, locationsFor, supplier } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

/**
 * One agency in one place: how it performs, what it charges and every change to that, its Pros, its paperwork and how
 * it connects. Buyers also decide here whether it gets their new shifts. Agencies only see their own.
 */

const FLOWS = ["Shift requests", "Pro assignments", "Clock-ins", "Timesheets", "Invoices"]

export function AgencyPage({ id }: { id: string }) {
  const { ws } = useWorkspace()
  const found = SUPPLIERS.some((s) => s.id === id)
  if (!found || (ws.kind === "supplier" && ws.supplierId !== id)) {
    return (
      <div className="pt-10">
        <EmptyState
          icon={Building2}
          title="Agency not found"
          description={found ? "Agencies only see their own page." : "It may have been removed or the link is wrong."}
          actions={
            <Button asChild variant="outline">
              <Link href={ws.kind === "compass" ? "/agencies" : "/rates"}>{ws.kind === "compass" ? "Back to Agencies" : "Back to Rate Cards"}</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return <AgencyBody key={id} supplierId={id} />
}

function AgencyBody({ supplierId }: { supplierId: string }) {
  const data = useData()
  const { ws } = useWorkspace()
  const setApproval = useStore((s) => s.setSupplierApproval)
  const sup = supplier(supplierId)
  const buyerId = ws.kind === "buyer" ? ws.buyerId : undefined
  const program = ws.kind === "compass"
  const cities = buyerId ? [...new Set(locationsFor(buyerId).map((l) => l.cityId))].filter((id) => sup.cityIds.includes(id)) : sup.cityIds
  const [cityId, setCityId] = useState(cities[0] ?? "")
  const m = metricsFor(data, sup.id, buyerId)
  const roster = complianceScore(data, sup.id)
  const score = supplierScore(metricsFor(data, sup.id))
  const approved = buyerId ? (data.approvals[buyerId] ?? []).includes(sup.id) : false
  const approvedBy = BUYERS.filter((b) => (data.approvals[b.id] ?? []).includes(sup.id))
  const cards = data.rateCards
    .filter((c) => c.supplierId === sup.id && c.cityId === cityId && c.status === "active")
    .sort((a, b) => POSITIONS.findIndex((p) => p.id === a.positionId) - POSITIONS.findIndex((p) => p.id === b.positionId))
  const pros = data.pros.filter((p) => p.supplierId === sup.id)
  const active = pros.filter((p) => p.status === "active")
  const cleared = active.filter((p) => readiness(p).ready).length
  const count = (summary: ReturnType<typeof summaryOf>) => pros.filter((p) => summaryOf(p) === summary).length
  const coiDays = sup.onboarded ? daysFromToday(sup.onboarded.coiExpiresOn) : sup.coiExpiresInDays
  const coiOn = sup.onboarded?.coiExpiresOn ?? addDaysISO(todayISO(), sup.coiExpiresInDays)

  const stats = [
    { label: "Fill rate", value: pct(m.fillRate), info: "Share of spots filled on shifts that already happened." },
    { label: "Time to fill", value: formatTimeToFill(m.hoursToFill), info: "Median time from posting to a Pro confirming." },
    { label: "No-show rate", value: pct(m.noShowRate, 1), info: "Share of confirmed Pros who didn't show up." },
    {
      label: "Compliance score",
      value: roster.active ? String(roster.score) : "--",
      info: `Out of 100. Most of it is the share of active Pros cleared to work today (${roster.cleared} of ${roster.active}); the rest is the share with no document expiring in the next 30 days (${roster.expiring} expiring)${roster.held ? `. ${plural(roster.held, "document")} held for Compass` : ""}.`,
    },
  ]

  return (
    <>
      <div className="flex flex-col gap-4 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <SupplierLogo supplierId={sup.id} size="xl" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-featured-1 font-semibold">{sup.name}</h1>
              <StatusBadge tone="neutral">Score {score}</StatusBadge>
              {sup.onboarded && <StatusBadge tone="primary">New</StatusBadge>}
            </div>
            <span className="text-body-2 text-faded">
              {sup.cityIds.map((id) => city(id).name).join(", ")}
              {program && ` · Approved by ${approvedBy.length ? joinNames(approvedBy.map((b) => b.name)) : "no buyers yet"}`}
            </span>
          </div>
        </div>
        {buyerId && (
          <label className="flex shrink-0 items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
            <span className="flex flex-col">
              <span className="text-body-3 font-semibold">Send my new shifts to {sup.shortName}</span>
              <span className="text-caption-1 text-faded">Approved agencies are notified when you post a shift.</span>
            </span>
            <Switch
              checked={approved}
              onCheckedChange={(on) => {
                void setApproval(buyerId, sup.id, on)
                toast.success(on ? `${sup.shortName} will get your new shifts` : `${sup.shortName} won't get your new shifts`)
              }}
            />
          </label>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Surface elevated className="overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {stats.map((x) => (
                <div key={x.label} className="flex flex-col gap-0.5 bg-card px-5 py-4">
                  <span className="flex items-center gap-1 text-caption-1 text-faded">
                    {x.label} <InfoTip>{x.info}</InfoTip>
                  </span>
                  <span className="text-featured-3 font-semibold tabular">{x.value}</span>
                </div>
              ))}
            </div>
            <p className="border-t border-border px-5 py-2.5 text-caption-1 text-subtle">{buyerId ? "From shifts it filled at your locations, last 28 days" : "Across every buyer, last 28 days"}</p>
          </Surface>

          <Surface elevated className="overflow-hidden" data-tour="agency-rates">
            <SurfaceHeader
              title="Rates"
              info={buyerId ? "What you pay per hour for each role." : "Pay rate is what the Pro earns. Markup is what the agency keeps. Bill rate is what Compass pays."}
              actions={cities.length > 1 ? <PillTabs size="sm" value={cityId} onChange={setCityId} items={cities.map((id) => ({ value: id, label: city(id).name }))} /> : undefined}
            />
            {cards.length ? (
              <table className="mt-2 w-full text-body-3">
                <thead className="text-caption-1 text-faded">
                  <tr className="border-y border-border bg-tint-faded">
                    <th className="px-5 py-2 text-left font-medium">{cities.length > 1 ? "Position" : `Position, ${city(cityId).name}`}</th>
                    {!buyerId && <th className="px-5 py-2 text-right font-medium">Pay rate</th>}
                    {!buyerId && <th className="px-5 py-2 text-right font-medium">Markup</th>}
                    <th className="px-5 py-2 text-right font-medium">Bill rate</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr key={c.id} className="border-t border-border/70 first:border-t-0">
                      <td className="px-5 py-2.5">{POSITIONS.find((p) => p.id === c.positionId)?.name}</td>
                      {!buyerId && <td className="px-5 py-2.5 text-right tabular text-faded">{money(c.proRate)}</td>}
                      {!buyerId && (
                        <td className={cn("px-5 py-2.5 text-right tabular", c.markupPct > PROGRAM.maxMarkupPct ? "font-semibold text-critical-fg" : "text-faded")}>
                          {c.markupPct > PROGRAM.maxMarkupPct ? (
                            <Tip content={`Over the program's ${PROGRAM.maxMarkupPct}% cap`}>
                              <span>
                                {money(c.billRate - c.proRate)} · {c.markupPct}%
                              </span>
                            </Tip>
                          ) : (
                            <>
                              {money(c.billRate - c.proRate)} · {c.markupPct}%
                            </>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-2.5 text-right font-semibold tabular">{money(c.billRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 pt-2 pb-5 text-body-3 text-faded">No rates in {city(cityId).name} yet.</p>
            )}
          </Surface>
        </div>

        <div className="flex flex-col gap-4">
          {!buyerId && (
            <Surface elevated>
              <SurfaceHeader
                title="Pros"
                description={`${active.length} active · ${active.length ? pct(cleared / active.length) : "0%"} cleared to work`}
                actions={
                  <Button asChild variant="ghost" size="sm" className="text-faded">
                    <Link href={`/professionals?agency=${sup.id}`}>
                      Open <ArrowRight />
                    </Link>
                  </Button>
                }
              />
              <ul className="flex flex-col gap-2 px-5 pt-2 pb-5 text-body-3">
                {[
                  { label: "Onboarding", n: count("onboarding"), tone: "text-faded" },
                  { label: "Missing or expired documents", n: count("action_needed"), tone: "text-critical-fg" },
                  { label: "A document expiring within 30 days", n: count("expiring"), tone: "text-warning-fg" },
                ].map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3">
                    <span className="text-faded">{r.label}</span>
                    <span className={r.n ? `font-semibold tabular ${r.tone}` : "tabular text-subtle"}>{r.n}</span>
                  </li>
                ))}
              </ul>
            </Surface>
          )}

          {!buyerId && (
            <Surface elevated>
              <SurfaceHeader title="Paperwork" />
              <dl className="flex flex-col gap-3 px-5 pt-2 pb-5 text-body-3">
                <div className="flex items-start justify-between gap-3">
                  <dt className="flex flex-col">
                    <span className="font-medium">Certificate of insurance</span>
                    <span className="text-caption-1 text-faded">{sup.onboarded?.coiFile ?? "On file"}</span>
                  </dt>
                  <dd className="flex flex-col items-end gap-1">
                    <StatusBadge tone={coiDays <= 14 ? "critical" : coiDays <= 30 ? "warning" : "positive"} size="sm">
                      {coiDays <= 30 ? `Expires in ${plural(coiDays, "day")}` : "Valid"}
                    </StatusBadge>
                    <span className="text-caption-1 text-faded">Until {formatDateShort(coiOn)}</span>
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="font-medium">Master services agreement</dt>
                  <dd className="text-faded">{sup.onboarded?.msaSignedOn ? `Signed ${formatDateShort(sup.onboarded.msaSignedOn)}` : "Signed"}</dd>
                </div>
              </dl>
            </Surface>
          )}

          <Surface elevated>
            <SurfaceHeader title="Connection" description={sup.integrationDetail} />
            <ul className="flex flex-col gap-1.5 px-5 pt-2 pb-5">
              {FLOWS.map((f) => {
                const live = sup.integration === "api" || f === "Shift requests"
                return (
                  <li key={f} className="flex items-center justify-between text-body-3">
                    <span>{f}</span>
                    <span className={live ? "inline-flex items-center gap-1 text-caption-1 font-semibold text-positive-fg" : "inline-flex items-center gap-1 text-caption-1 text-faded"}>
                      {live ? <Check className="size-3.5" /> : <FileSpreadsheet className="size-3.5" />}
                      {live ? (sup.integration === "api" ? "Automatic" : "Sent instantly") : "By CSV"}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Surface>
        </div>
      </div>

      <RateChanges supplierId={sup.id} />
    </>
  )
}

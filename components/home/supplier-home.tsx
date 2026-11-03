"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { useMemo } from "react"

import { WorkspaceAvatar } from "@/components/brand/org-avatar"
import { InfoTip } from "@/components/common/info-tip"
import { SectionTitle } from "@/components/common/page-header"
import { StatCard } from "@/components/common/stat-card"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { FillTrendChart } from "@/components/home/charts"
import { Greeting, TodoSection } from "@/components/home/shared"
import { useData, useWorkspace } from "@/hooks/use-app"
import { readiness } from "@/lib/compliance"
import { addDaysISO, todayISO } from "@/lib/dates"
import { moneyWhole, plural } from "@/lib/format"
import { fillTrendFor, filledCount, formatTimeToFill, groupPhase, isOpenTo, metricsFor, todosFor } from "@/lib/metrics"
import { BUYERS, WORKSPACES, locationsFor, supplier } from "@/lib/reference"

export function SupplierHome() {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const sup = supplier(ws.supplierId!)

  const view = useMemo(() => {
    const from = addDaysISO(todayISO(), -28)
    const active = data.pros.filter((p) => p.supplierId === sup.id && p.status === "active")
    const buyers = BUYERS.map((b) => ({
      buyer: b,
      ws: WORKSPACES.find((w) => w.buyerId === b.id),
      approved: (data.approvals[b.id] ?? []).includes(sup.id),
      locations: locationsFor(b.id).length,
      open: data.groups.filter(
        (g) => g.buyerId === b.id && isOpenTo(g, sup.id) && groupPhase(g) === "upcoming" && filledCount(g) < g.slots.length,
      ).length,
      revenue: data.timesheets
        .filter((t) => t.supplierId === sup.id && t.buyerId === b.id && t.date >= from)
        .reduce((s, t) => s + t.hours * t.billRate + t.tips, 0),
    }))
    return {
      m: metricsFor(data, sup.id),
      trend: fillTrendFor(data, scope),
      todos: todosFor(data, ws),
      ready: active.filter((p) => readiness(p).ready).length,
      activeCount: active.length,
      approvedBy: buyers.filter((b) => b.approved),
      notYet: buyers.filter((b) => !b.approved),
    }
  }, [data, scope, ws, sup.id])

  return (
    <>
      <Greeting subtitle={`${sup.name} · ${sup.integration === "api" ? "Connected by API" : "Connected by CSV"}`} />
      <TodoSection todos={view.todos} />

      <section className="flex flex-col gap-3">
        <SectionTitle title="My metrics" description="Last 28 days" info="What buyers and Compass see when they rank agencies." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Fill rate"
            info="Share of spots you filled on shifts that already happened."
            value={view.m.fillRate * 100}
            suffix="%"
            sub={`${view.m.slotsFilled} spots filled`}
            href="/shifts"
          />
          <StatCard
            label="Time to fill"
            info="Median time from a buyer posting a shift to your worker confirming."
            value={view.m.hoursToFill < 1 ? Math.round(view.m.hoursToFill * 60) : Math.round(view.m.hoursToFill)}
            suffix={view.m.hoursToFill < 1 ? "min" : "hrs"}
            sub={`Median: ${formatTimeToFill(view.m.hoursToFill)}`}
            href="/shifts"
          />
          <StatCard
            label="No-show rate"
            info="Share of confirmed workers who didn't show up. Lower is better."
            value={view.m.noShowRate * 100}
            suffix="%"
            sub="Of confirmed workers"
            href="/shifts"
          />
          <StatCard
            label="Compliance"
            info="Share of your active workers with every document their positions need: background check, I-9, Compass orientation and certifications."
            value={view.m.compliance * 100}
            suffix="%"
            sub={`${view.ready} of ${view.activeCount} active workers ready`}
            href="/professionals"
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Surface elevated className="lg:col-span-2">
          <SurfaceHeader
            title={
              <>
                Performance on shifts <InfoTip>Solid line: fill rate. Dashed line: no-show rate.</InfoTip>
              </>
            }
            description="Shifts already worked, by week"
          />
          <div className="px-3 pt-2 pb-4">
            <FillTrendChart data={view.trend} />
          </div>
        </Surface>
        <Surface elevated>
          <SurfaceHeader title="Buyers that approved you" description="Revenue, last 28 days" info="Only buyers that approved you send you their new shifts." />
          <ul className="flex flex-col gap-0.5 px-2 pt-2 pb-2">
            {view.approvedBy.map((b) => (
              <li key={b.buyer.id}>
                <Link href="/shifts" className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-100 hover:bg-hover">
                  {b.ws && <WorkspaceAvatar ws={b.ws} size="md" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-3 font-semibold">{b.buyer.name}</span>
                    <span className="truncate text-caption-1 text-faded">
                      {plural(b.locations, "location")} · {b.open ? `${plural(b.open, "shift")} need workers` : "All shifts filled"}
                    </span>
                  </span>
                  <span className="text-body-3 font-medium tabular">{moneyWhole(b.revenue)}</span>
                  <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
            {!view.approvedBy.length && <li className="px-2.5 py-3 text-body-3 text-faded">No buyers have approved you yet.</li>}
          </ul>
          {view.notYet.length > 0 && (
            <p className="border-t border-border px-5 py-3 text-caption-1 text-faded">
              Not approved yet by {view.notYet.map((b) => b.buyer.name).join(" and ")}.
            </p>
          )}
        </Surface>
      </div>
    </>
  )
}

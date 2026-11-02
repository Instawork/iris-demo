"use client"

import { ChevronRight } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { InfoTip } from "@/components/common/info-tip"
import { ORG_LEVELS, location, orgPath } from "@/lib/reference"
import { formatValue, measureInfo, measureLabel, type MeasureValues, type ReportGroup, type ReportPage, type ReportResult } from "@/lib/reports"
import type { ReportMeasure } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * A by-location report filed the way Compass is organized: super sector, sector, region and district, down to each
 * unit. A branch adds up what adds up, and works cost per hour out again from its own spend and hours.
 */

interface Node {
  id: string
  name: string
  hint?: string
  values: Partial<MeasureValues>
  children: Node[]
}

function rollUp(nodes: Node[], measures: ReportMeasure[]) {
  for (const n of nodes) {
    if (!n.children.length) continue
    rollUp(n.children, measures)
    const sum = (m: ReportMeasure) => n.children.reduce((s, c) => s + (c.values[m] ?? 0), 0)
    for (const m of measures) if (measureInfo(m).additive) n.values[m] = sum(m)
    if (measures.includes("costPerHour")) {
      const hours = sum("hours")
      n.values.costPerHour = measures.includes("spend") && hours ? Math.round((sum("spend") / hours) * 100) / 100 : null
    }
  }
}

function treeOf(groups: ReportGroup[], measures: ReportMeasure[]) {
  const root: Node = { id: "root", name: "", values: {}, children: [] }
  for (const g of groups) {
    let node = root
    for (const place of orgPath(location(g.key))) {
      let child = node.children.find((c) => c.id === place.id)
      if (!child) {
        child = { ...place, values: {}, children: [] }
        node.children.push(child)
      }
      node = child
    }
    node.children.push({ id: `u:${g.key}`, name: g.label, hint: location(g.key).costCenter, values: g.values, children: [] })
  }
  rollUp(root.children, measures)
  const first = measures[0]
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => (b.values[first] ?? -Infinity) - (a.values[first] ?? -Infinity))
    nodes.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

export function LocationTree({ page, result }: { page: ReportPage; result: ReportResult }) {
  const { measures } = result.spec
  const tree = useMemo(() => treeOf(result.groups, measures), [result.groups, measures])
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const first = measures[0]
  const sum = result.total[first] ?? 0
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rows = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const branch = n.children.length > 0
      const open = !closed.has(n.id)
      const v = n.values[first] ?? 0
      return (
        <Fragment key={n.id}>
          <tr
            onClick={branch ? () => toggle(n.id) : undefined}
            className={cn("border-t border-border/70", branch && "cursor-pointer hover:bg-hover/60", depth === 0 && "bg-page-faded/60")}
            aria-expanded={branch ? open : undefined}
          >
            <td className="py-2.5 pr-3" style={{ paddingLeft: 12 + depth * 18 }}>
              <span className="flex items-center gap-1.5">
                {branch ? (
                  <ChevronRight className={cn("size-3.5 shrink-0 text-faded transition-transform duration-100", open && "rotate-90")} />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className={cn("truncate", branch ? "font-semibold" : "font-medium")}>{n.name}</span>
                  {!branch && n.hint && <span className="truncate font-mono text-caption-1 text-faded">{n.hint}</span>}
                </span>
                {branch && <span className="shrink-0 text-caption-2 text-faded">{ORG_LEVELS[depth]}</span>}
              </span>
            </td>
            {measures.map((m, i) => (
              <Fragment key={m}>
                <td className={cn("px-3 py-2.5 text-right tabular", i === 0 && "font-semibold")}>{formatValue(m, n.values[m])}</td>
                {i === 0 && page.share && (
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="h-1.5 w-28 overflow-hidden rounded-full bg-page-faded">
                        <span className="block h-full rounded-full bg-brand-strong" style={{ width: `${sum > 0 ? (v / sum) * 100 : 0}%` }} />
                      </span>
                      <span className="w-9 text-right text-caption-1 text-faded tabular">{sum > 0 ? `${Math.round((v / sum) * 100)}%` : "—"}</span>
                    </span>
                  </td>
                )}
              </Fragment>
            ))}
          </tr>
          {branch && open && rows(n.children, depth + 1)}
        </Fragment>
      )
    })

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-body-3">
        <thead>
          <tr className="text-caption-1 text-faded">
            <th className="h-9 pr-3 pl-3 text-left font-medium">Location</th>
            {measures.map((m, i) => (
              <Fragment key={m}>
                <th className="h-9 px-3 text-right font-medium">
                  <span className="inline-flex flex-row-reverse items-center gap-1">
                    {measureLabel(page, m)}
                    <InfoTip>{measureInfo(m).info}</InfoTip>
                  </span>
                </th>
                {i === 0 && page.share && <th className="h-9 w-48 px-3 text-left font-medium">Share</th>}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>{rows(tree, 0)}</tbody>
      </table>
    </div>
  )
}

"use client"

import { ChevronRight } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { InfoTip } from "@/components/common/info-tip"
import { money } from "@/lib/format"
import { PROGRAM, buyer, departmentOf, location } from "@/lib/reference"
import { expensesOf } from "@/lib/timesheets"
import type { Invoice, InvoiceLine } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Spend broken down the way Compass is organized: super sector, sector, regional business, then each unit and
 * department by cost center. The monthly invoice uses it for what was billed, less credits, so the tree adds up to the
 * invoice; accruals use it for what was worked and isn't invoiced yet.
 */

interface Place {
  id: string
  name: string
  costCenter?: string
}

interface Node extends Place {
  amounts: number[]
  hours: number
  children: Node[]
}

/** Something charged to a cost center, with one amount per column. */
export interface BreakdownItem {
  buyerId: string
  locationId: string
  departmentId?: string
  positionId: string
  hours: number
  amounts: number[]
}

export interface BreakdownColumn {
  header: string
  info?: string
}

const LEVELS = ["Super sector", "Sector", "Regional business"]

/** Where a charge sits in Compass, top down. */
export function placeAt(item: Pick<BreakdownItem, "buyerId" | "locationId" | "departmentId" | "positionId">): Place[] {
  const b = buyer(item.buyerId)
  const unit = location(item.locationId)
  const dept = departmentOf(item.locationId, item.departmentId, item.positionId)
  return [
    { id: `s:${b.sector}`, name: b.sector },
    { id: `b:${b.brand}`, name: b.brand },
    { id: `r:${b.id}`, name: b.name },
    { id: `u:${unit.id}`, name: unit.name, costCenter: unit.costCenter },
    ...(dept ? [{ id: `d:${unit.id}:${dept.id}`, name: dept.name, costCenter: dept.costCenter }] : []),
  ]
}

export const placeOf = (inv: Invoice, line: InvoiceLine) => placeAt({ ...line, buyerId: inv.buyerId })

/** Each invoice line as billed, less what was credited on it. */
export function invoiceItems(invoices: Invoice[]): BreakdownItem[] {
  return invoices.flatMap((inv) => {
    const credited = new Map<string, { amount: number; hours: number }>()
    for (const c of inv.credits ?? []) {
      const prev = credited.get(c.lineId) ?? { amount: 0, hours: 0 }
      credited.set(c.lineId, { amount: prev.amount + c.amount, hours: prev.hours + c.hours })
    }
    return inv.lines.map((line) => {
      const credit = credited.get(line.id)
      return {
        ...line,
        buyerId: inv.buyerId,
        hours: line.hours - (credit?.hours ?? 0),
        amounts: [line.amount + line.tips + expensesOf(line) - (credit?.amount ?? 0)],
      }
    })
  })
}

function treeOf(items: BreakdownItem[], width: number) {
  const root: Node = { id: "root", name: "", amounts: [], hours: 0, children: [] }
  for (const item of items) {
    let node = root
    for (const place of placeAt(item)) {
      let child = node.children.find((c) => c.id === place.id)
      if (!child) {
        child = { ...place, amounts: Array(width).fill(0), hours: 0, children: [] }
        node.children.push(child)
      }
      item.amounts.forEach((a, i) => (child!.amounts[i] += a))
      child.hours += item.hours
      node = child
    }
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => b.amounts[width - 1] - a.amounts[width - 1])
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

const AMOUNT: BreakdownColumn[] = [{ header: "Amount" }]

export function Breakdown({ items, columns = AMOUNT }: { items: BreakdownItem[]; columns?: BreakdownColumn[] }) {
  const tree = useMemo(() => treeOf(items, columns.length), [items, columns.length])
  const [open, setOpen] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    const walk = (nodes: Node[], depth: number) => {
      for (const n of nodes) {
        if (depth < LEVELS.length && n.id !== "s:Education") ids.add(n.id)
        walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return ids
  })
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const last = columns.length - 1

  const rows = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const expandable = n.children.length > 0
      const expanded = open.has(n.id)
      return (
        <Fragment key={n.id}>
          <tr
            onClick={expandable ? () => toggle(n.id) : undefined}
            className={cn("border-t border-border/70", expandable && "cursor-pointer hover:bg-hover/60", depth === 0 && "bg-page-faded/60")}
            aria-expanded={expandable ? expanded : undefined}
          >
            <td className="py-2 pr-3" style={{ paddingLeft: 12 + depth * 18 }}>
              <span className="flex items-center gap-1.5">
                {expandable ? (
                  <ChevronRight className={cn("size-3.5 shrink-0 text-faded transition-transform duration-100", expanded && "rotate-90")} />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className={cn("truncate", depth < LEVELS.length ? "font-semibold" : "font-medium")}>{n.name}</span>
                {depth < LEVELS.length && <span className="shrink-0 text-caption-2 text-faded">{LEVELS[depth]}</span>}
              </span>
            </td>
            <td className="px-3 py-2 font-mono text-caption-1 text-faded">{n.costCenter ?? ""}</td>
            <td className="px-3 py-2 text-right text-faded tabular">{Math.round(n.hours).toLocaleString("en-US")}</td>
            {n.amounts.map((a, i) => (
              <td key={columns[i].header} className={cn("px-3 py-2 text-right tabular", i === last ? "font-semibold" : a ? "" : "text-subtle")}>
                {a || i === last ? money(a) : "--"}
              </td>
            ))}
          </tr>
          {expanded && rows(n.children, depth + 1)}
        </Fragment>
      )
    })

  return (
    <table className="w-full text-body-3">
      <thead>
        <tr className="text-caption-1 text-faded">
          <th className="py-2 pr-3 pl-3 text-left font-medium">{PROGRAM.name}</th>
          <th className="px-3 py-2 text-left font-medium">Cost center</th>
          <th className="px-3 py-2 text-right font-medium">Hours</th>
          {columns.map((c) => (
            <th key={c.header} className="px-3 py-2 text-right font-medium">
              <span className="inline-flex items-center gap-1">
                {c.header}
                {c.info && <InfoTip>{c.info}</InfoTip>}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{rows(tree, 0)}</tbody>
    </table>
  )
}

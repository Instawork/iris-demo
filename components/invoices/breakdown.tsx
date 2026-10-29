"use client"

import { ChevronRight } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { money } from "@/lib/format"
import { PROGRAM, buyer, departmentOf, location } from "@/lib/reference"
import type { Invoice, InvoiceLine } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * A consolidated invoice broken down the way Compass is organized: super sector, sector, regional business, then each
 * unit and department by cost center. Amounts are what was billed there, less credits, so the tree adds up to the invoice.
 */

interface Place {
  id: string
  name: string
  costCenter?: string
}

interface Node extends Place {
  amount: number
  hours: number
  children: Node[]
}

const LEVELS = ["Super sector", "Sector", "Regional business"]

/** Where a line sits in Compass, top down. */
export function placeOf(inv: Invoice, line: InvoiceLine): Place[] {
  const b = buyer(inv.buyerId)
  const unit = location(line.locationId)
  const dept = departmentOf(line.locationId, line.departmentId, line.positionId)
  return [
    { id: `s:${b.sector}`, name: b.sector },
    { id: `b:${b.brand}`, name: b.brand },
    { id: `r:${b.id}`, name: b.name },
    { id: `u:${unit.id}`, name: unit.name, costCenter: unit.costCenter },
    ...(dept ? [{ id: `d:${unit.id}:${dept.id}`, name: dept.name, costCenter: dept.costCenter }] : []),
  ]
}

function treeOf(invoices: Invoice[]) {
  const root: Node = { id: "root", name: "", amount: 0, hours: 0, children: [] }
  for (const inv of invoices) {
    const credited = new Map<string, { amount: number; hours: number }>()
    for (const c of inv.credits ?? []) {
      const prev = credited.get(c.lineId) ?? { amount: 0, hours: 0 }
      credited.set(c.lineId, { amount: prev.amount + c.amount, hours: prev.hours + c.hours })
    }
    for (const line of inv.lines) {
      const credit = credited.get(line.id)
      const amount = line.amount + line.tips - (credit?.amount ?? 0)
      const hours = line.hours - (credit?.hours ?? 0)
      let node = root
      for (const place of placeOf(inv, line)) {
        let child = node.children.find((c) => c.id === place.id)
        if (!child) {
          child = { ...place, amount: 0, hours: 0, children: [] }
          node.children.push(child)
        }
        child.amount += amount
        child.hours += hours
        node = child
      }
    }
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => b.amount - a.amount)
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

export function Breakdown({ invoices }: { invoices: Invoice[] }) {
  const tree = useMemo(() => treeOf(invoices), [invoices])
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
            <td className="px-3 py-2 text-right font-semibold tabular">{money(n.amount)}</td>
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
          <th className="px-3 py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>{rows(tree, 0)}</tbody>
    </table>
  )
}

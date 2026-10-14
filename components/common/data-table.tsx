"use client"

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react"
import { useMemo, useState } from "react"

import { InfoTip } from "@/components/common/info-tip"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

export interface Column<T> {
  id: string
  header: React.ReactNode
  info?: React.ReactNode
  cell: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  align?: "left" | "right" | "center"
  className?: string
  headerClassName?: string
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  selectable,
  selected,
  onSelectedChange,
  isSelectable,
  onRowClick,
  rowClassName,
  empty,
  pageSize = 20,
  initialSort,
  className,
  dense,
}: {
  rows: T[]
  columns: Column<T>[]
  getRowId: (row: T) => string
  selectable?: boolean
  selected?: Set<string>
  onSelectedChange?: (next: Set<string>) => void
  isSelectable?: (row: T) => boolean
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  empty?: React.ReactNode
  pageSize?: number
  initialSort?: { id: string; dir: "asc" | "desc" }
  className?: string
  dense?: boolean
}) {
  const [sort, setSort] = useState(initialSort)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.id === sort.id)
    if (!col?.sortValue) return rows
    const dir = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [rows, columns, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize)
  const selectableRows = visible.filter((r) => !isSelectable || isSelectable(r))
  const allOnPage = selectable && selectableRows.length > 0 && selectableRows.every((r) => selected?.has(getRowId(r)))
  const someOnPage = selectable && selectableRows.some((r) => selected?.has(getRowId(r)))

  const toggleAll = () => {
    if (!onSelectedChange || !selected) return
    const next = new Set(selected)
    if (allOnPage) selectableRows.forEach((r) => next.delete(getRowId(r)))
    else selectableRows.forEach((r) => next.add(getRowId(r)))
    onSelectedChange(next)
  }
  const toggleOne = (id: string) => {
    if (!onSelectedChange || !selected) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedChange(next)
  }

  if (!rows.length && empty) return <>{empty}</>

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-raised", className)}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              {selectable && (
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all on this page"
                  />
                </th>
              )}
              {columns.map((c) => {
                const active = sort?.id === c.id
                const SortIcon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown
                return (
                  <th
                    key={c.id}
                    className={cn(
                      "h-9 px-3 text-caption-1 font-medium whitespace-nowrap text-faded",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.headerClassName,
                    )}
                  >
                    <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSort(active && sort.dir === "desc" ? { id: c.id, dir: "asc" } : { id: c.id, dir: "desc" })
                          }
                          className={cn("group/sort inline-flex items-center gap-1 transition-colors hover:text-foreground", active && "text-foreground")}
                        >
                          {c.header}
                          <SortIcon className={cn("size-3", !active && "opacity-0 transition-opacity group-hover/sort:opacity-60")} />
                        </button>
                      ) : (
                        c.header
                      )}
                      {c.info && <InfoTip>{c.info}</InfoTip>}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = getRowId(row)
              const isSel = selected?.has(id)
              const canSelect = !isSelectable || isSelectable(row)
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border/70 transition-colors duration-100 last:border-b-0",
                    onRowClick && "cursor-pointer",
                    isSel ? "bg-primary-faded" : "hover:bg-hover",
                    rowClassName?.(row),
                  )}
                >
                  {selectable && (
                    <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={!!isSel}
                        disabled={!canSelect}
                        onCheckedChange={() => toggleOne(id)}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-3 align-middle text-body-3 whitespace-nowrap",
                        dense ? "py-2" : "py-2.5",
                        c.align === "right" && "text-right tabular",
                        c.align === "center" && "text-center",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-caption-1 text-faded">
          <span className="tabular">
            Showing {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setPage(Math.max(0, current - 1))}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background transition-colors duration-100 hover:bg-hover disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 tabular">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              disabled={current >= pages - 1}
              onClick={() => setPage(Math.min(pages - 1, current + 1))}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background transition-colors duration-100 hover:bg-hover disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

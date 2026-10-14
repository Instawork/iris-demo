"use client"

import { Tip } from "@/components/common/info-tip"
import { StatusBadge } from "@/components/common/status-badge"
import { supplier } from "@/lib/reference"

/** Stands in for an upload button when the supplier's integration already sends that data. */
export function SyncedBadge({ supplierId }: { supplierId: string }) {
  return (
    <Tip content={supplier(supplierId).integrationDetail}>
      <span className="inline-flex h-9 items-center">
        <StatusBadge tone="positive" dot>
          Synced by API
        </StatusBadge>
      </span>
    </Tip>
  )
}

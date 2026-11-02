"use client"

import { Tip } from "@/components/common/info-tip"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import type { Grade, Performance } from "@/lib/metrics"

/** An agency's grade and score, with what it's made of on hover. */

const TONE: Record<Grade, Tone> = { A: "positive", B: "primary", C: "warning", D: "critical" }

export function PerformanceBadge({ performance: p, size = "sm" }: { performance: Performance; size?: "sm" | "md" }) {
  return (
    <Tip
      content={
        <span className="flex flex-col gap-0.5">
          {p.parts.map((x) => (
            <span key={x.label} className="flex justify-between gap-4">
              <span>{x.label}</span>
              <span className="font-semibold tabular">{x.value}</span>
            </span>
          ))}
        </span>
      }
    >
      <span className="inline-flex">
        <StatusBadge tone={TONE[p.grade]} size={size}>
          <span className="font-bold">{p.grade}</span>
          <span className="tabular opacity-80">{p.score}</span>
        </StatusBadge>
      </span>
    </Tip>
  )
}

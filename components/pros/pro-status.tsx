"use client"

import { CheckCircle2, CircleDashed, Star } from "lucide-react"

import { Tip } from "@/components/common/info-tip"
import { StatusBadge } from "@/components/common/status-badge"
import type { RequirementRow } from "@/lib/compliance"
import { formatDateShort } from "@/lib/dates"
import type { ComplianceStatus, OnboardingStatus } from "@/lib/pro-profile"
import { cn } from "@/lib/utils"

const issueText = (row: RequirementRow) => {
  const expires = row.item?.expiresOn
  if (row.state === "expired") return expires ? `expired ${formatDateShort(expires)}` : "expired"
  if (row.state === "expiring") return expires ? `expires ${formatDateShort(expires)}` : "expiring"
  return row.state
}

function IssueList({ rows }: { rows: RequirementRow[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {rows.map((r) => (
        <span key={r.id}>
          {r.label}: <span className="opacity-70">{issueText(r)}</span>
        </span>
      ))}
    </span>
  )
}

export function ComplianceBadge({ status, size }: { status: ComplianceStatus; size?: "sm" | "md" }) {
  const badge = (
    <StatusBadge tone={status.tone} size={size} dot>
      {status.label}
    </StatusBadge>
  )
  if (!status.issues.length) return badge
  return (
    <Tip content={<IssueList rows={status.issues} />}>
      <span className="inline-flex">{badge}</span>
    </Tip>
  )
}

export function OnboardingLabel({ status }: { status: OnboardingStatus }) {
  if (status.complete)
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2 className="size-3.5 text-positive" />
        Complete
      </span>
    )
  return (
    <Tip content={status.steps.length ? <IssueList rows={status.steps} /> : null}>
      <span className="inline-flex items-center gap-1.5 font-medium text-warning-fg">
        <CircleDashed className="size-3.5" />
        {status.label}
      </span>
    </Tip>
  )
}

export function Rating({ value, empty = "--", className }: { value: number; empty?: string; className?: string }) {
  if (!value) return <span className={cn("text-subtle", className)}>{empty}</span>
  return (
    <span className={cn("inline-flex items-center gap-1 tabular", className)}>
      <Star className="size-3.5 fill-warning text-warning" />
      {value.toFixed(1)}
    </span>
  )
}

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span role="img" aria-label={`${value} of 5 stars`} className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-3.5", n <= value ? "fill-warning text-warning" : "text-border-strong")} />
      ))}
    </span>
  )
}

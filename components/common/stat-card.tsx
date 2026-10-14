"use client"

import Link from "next/link"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { InfoTip } from "@/components/common/info-tip"
import { cn } from "@/lib/utils"

export interface StatTrend {
  delta: number
  label: string
  goodWhen: "up" | "down"
  format?: (delta: number) => string
}

/** KPI entry point: label, value and an optional trend; the whole card links to the detail. */
export function StatCard({
  label,
  info,
  value,
  prefix,
  suffix,
  decimals = 0,
  sub,
  trend,
  href,
  footer,
}: {
  label: string
  info?: React.ReactNode
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  sub?: React.ReactNode
  trend?: StatTrend
  href?: string
  footer?: React.ReactNode
}) {
  const good = trend ? (trend.goodWhen === "up" ? trend.delta >= 0 : trend.delta <= 0) : true
  const TrendIcon = trend && trend.delta >= 0 ? ArrowUpRight : ArrowDownRight
  const formatted = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-1.5 rounded-xl border border-border bg-card p-4 shadow-raised transition-colors duration-100",
        href && "hover:border-border-strong",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-body-3 text-faded">
          <span className="truncate">{label}</span>
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        {trend && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 text-caption-1 leading-5 font-medium tabular ring-1 ring-inset",
              good ? "text-positive-fg ring-positive-border" : "text-critical-fg ring-critical-border",
            )}
          >
            <TrendIcon className="size-3.5" />
            {trend.format ? trend.format(trend.delta) : `${Math.abs(trend.delta).toFixed(1)}%`}
          </span>
        )}
      </div>
      <div className="flex items-baseline text-[28px] leading-9 font-semibold tracking-[-0.035em] text-foreground tabular">
        {prefix}
        {formatted}
        {suffix && <span className="ml-1 text-body-2 font-medium tracking-normal text-faded">{suffix}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 text-caption-1 text-faded">
        <span className="truncate">{sub ?? trend?.label}</span>
        {href && <ArrowUpRight className="size-3.5 shrink-0 text-subtle opacity-0 transition-opacity duration-100 group-hover:opacity-100" />}
      </div>
      {footer && <div className="pt-1.5">{footer}</div>}
    </div>
  )
  if (!href) return body
  return (
    <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      {body}
    </Link>
  )
}

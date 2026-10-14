"use client"

import { motion } from "motion/react"

import { cn } from "@/lib/utils"

const COLOR = {
  positive: "var(--positive)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  neutral: "var(--tint)",
}

/** Vertical fill-rate pipe on shift cards, filled to the share of spots booked. */
export function FillPipe({
  ratio,
  tone,
  className,
}: {
  ratio: number
  tone: keyof typeof COLOR
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, ratio))
  return (
    <span className={cn("relative inline-block h-6 w-1.5 shrink-0 overflow-hidden rounded-full bg-tint", className)}>
      <motion.span
        className="absolute inset-x-0 bottom-0 rounded-full"
        style={{ background: COLOR[tone] }}
        initial={false}
        animate={{ height: `${Math.max(pct, tone === "neutral" ? 1 : 0.18) * 100}%` }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      />
    </span>
  )
}

/** Slim horizontal meter for tables and cards. */
export function Meter({
  value,
  tone = "primary",
  className,
}: {
  value: number
  tone?: "primary" | "positive" | "warning" | "critical"
  className?: string
}) {
  const colors = {
    primary: "var(--foreground)",
    positive: "var(--positive)",
    warning: "var(--warning)",
    critical: "var(--critical)",
  }
  return (
    <span className={cn("relative block h-1 w-full overflow-hidden rounded-full bg-tint", className)}>
      <motion.span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: colors[tone] }}
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      />
    </span>
  )
}

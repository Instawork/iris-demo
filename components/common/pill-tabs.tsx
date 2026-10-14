"use client"

import { motion } from "motion/react"
import { useId } from "react"
import type { LucideIcon } from "lucide-react"

import { Tip } from "@/components/common/info-tip"
import { cn } from "@/lib/utils"

export interface PillTabItem<T extends string> {
  value: T
  label: React.ReactNode
  icon?: LucideIcon
  count?: number
  tooltip?: React.ReactNode
  disabled?: boolean
}

/** Segmented tabs with the selected chip sliding between items. */
export function PillTabs<T extends string>({
  value,
  onChange,
  items,
  size = "md",
  className,
}: {
  value: T
  onChange: (value: T) => void
  items: PillTabItem<T>[]
  size?: "sm" | "md"
  className?: string
}) {
  const layoutId = useId()
  return (
    <div
      role="tablist"
      className={cn("inline-flex w-fit items-center gap-0.5 rounded-lg bg-foreground/[0.045] p-0.5", className)}
    >
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon
        const button = (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap text-foreground transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40",
              size === "sm" ? "h-6 px-2 text-caption-1" : "h-7 px-2.5 text-body-3",
              !active && "text-faded hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`pill-${layoutId}`}
                className="absolute inset-0 rounded-md bg-background shadow-[0_1px_2px_rgba(10,10,11,0.08),0_0_0_1px_rgba(10,10,11,0.06)] dark:bg-white/[0.1] dark:shadow-none"
                transition={{ type: "spring", stiffness: 700, damping: 50, mass: 0.6 }}
              />
            )}
            {Icon && <Icon className="relative size-4" />}
            <span className="relative">{item.label}</span>
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "relative min-w-4 text-center text-caption-1 font-medium tabular",
                  active ? "text-faded" : "text-subtle",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
        return item.tooltip ? (
          <Tip key={item.value} content={item.tooltip}>
            {button}
          </Tip>
        ) : (
          button
        )
      })}
    </div>
  )
}

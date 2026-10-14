"use client"

import { Tip } from "@/components/common/info-tip"
import { initialsOf } from "@/lib/format"
import { hashString } from "@/lib/random"
import type { Pro, ProLevel } from "@/lib/types"
import { cn } from "@/lib/utils"

const HUES = ["#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", "#84cc16", "#f97316", "#64748b"]

const LEVEL_RING: Record<ProLevel, string> = {
  platinum: "#94a3b8",
  gold: "#eab308",
  silver: "#a1a1aa",
  bronze: "#c2410c",
}

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-caption-1",
  md: "size-9 text-body-3",
  lg: "size-12 text-body-2",
  xl: "size-16 text-featured-3",
}

export function ProAvatar({
  pro,
  name,
  size = "sm",
  ring,
  tooltip,
  className,
}: {
  pro?: Pick<Pro, "firstName" | "lastName" | "level">
  name?: string
  size?: keyof typeof SIZES
  ring?: boolean
  tooltip?: boolean
  className?: string
}) {
  const label = pro ? `${pro.firstName} ${pro.lastName}` : (name ?? "?")
  const hue = HUES[hashString(label) % HUES.length]
  const level = pro?.level
  const avatar = (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        SIZES[size],
        className,
      )}
      style={{
        background: `color-mix(in oklab, ${hue} 16%, var(--card))`,
        color: `color-mix(in oklab, ${hue} 72%, var(--foreground))`,
        boxShadow: ring && level ? `0 0 0 2px var(--card), 0 0 0 3.5px ${LEVEL_RING[level]}` : ring ? "0 0 0 2px var(--card)" : undefined,
      }}
    >
      {initialsOf(label)}
    </span>
  )
  if (!tooltip) return avatar
  return <Tip content={level ? `${label} · ${level[0].toUpperCase()}${level.slice(1)} Pro` : label}>{avatar}</Tip>
}

export function AvatarStack({
  pros,
  max = 3,
  size = "sm",
  className,
}: {
  pros: Pick<Pro, "id" | "firstName" | "lastName" | "level">[]
  max?: number
  size?: "xs" | "sm" | "md"
  className?: string
}) {
  const visible = pros.slice(0, max)
  const rest = pros.slice(max)
  return (
    <div className={cn("flex items-center", className)}>
      {visible.map((p, i) => (
        <span key={p.id} className={cn(i > 0 && "-ml-1.5")}>
          <ProAvatar pro={p} size={size} ring tooltip />
        </span>
      ))}
      {rest.length > 0 && (
        <Tip
          content={
            <span className="block max-w-[220px]">
              {rest
                .slice(0, 8)
                .map((p) => `${p.firstName} ${p.lastName}`)
                .join(", ")}
              {rest.length > 8 ? ` and ${rest.length - 8} more` : ""}
            </span>
          }
        >
          <span
            className={cn(
              "-ml-1.5 inline-flex items-center justify-center rounded-full bg-tint font-semibold text-faded ring-2 ring-card",
              SIZES[size],
            )}
          >
            +{rest.length}
          </span>
        </Tip>
      )}
    </div>
  )
}

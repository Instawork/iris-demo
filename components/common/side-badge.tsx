import { Landmark, Store, UsersRound, type LucideIcon } from "lucide-react"

import type { PersonaKind } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Which side of the program a screen belongs to. The demo moves between three: the buyer who orders shifts, the agency
 * that fills them, and Compass corporate that runs the program. People's names mean nothing to a newcomer; the side does.
 */
export const SIDES: Record<PersonaKind, { label: string; noun: string; icon: LucideIcon; color: string; does: string }> = {
  buyer: { label: "Buyer", noun: "the buyer", icon: Store, color: "var(--side-buyer)", does: "Orders shifts for its venues and approves the hours." },
  supplier: { label: "Agency", noun: "an agency", icon: UsersRound, color: "var(--side-agency)", does: "Fills shifts with its workers and bills for them." },
  compass: { label: "Corporate", noun: "Compass corporate", icon: Landmark, color: "var(--side-corporate)", does: "Runs the program: units, agencies, rates and spend." },
}

export function SideBadge({ kind, onDark, size = "md", className }: { kind: PersonaKind; onDark?: boolean; size?: "sm" | "md"; className?: string }) {
  const side = SIDES[kind]
  const Icon = side.icon
  const ink = onDark ? `color-mix(in oklch, ${side.color} 55%, white)` : side.color
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-caption-2" : "h-6 px-2.5 text-caption-1",
        className,
      )}
      style={{ color: ink, backgroundColor: `color-mix(in oklch, ${side.color} ${onDark ? 22 : 12}%, transparent)` }}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} strokeWidth={2.2} />
      {side.label}
    </span>
  )
}

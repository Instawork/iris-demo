import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  compact,
}: {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong/70 text-center",
        compact ? "gap-2 px-6 py-8" : "gap-3 px-8 py-14",
        className,
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-tint-faded ring-1 ring-border ring-inset">
        <Icon className="size-4 text-faded" />
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-body-3 font-semibold">{title}</p>
        {description && <p className="text-body-3 text-faded">{description}</p>}
      </div>
      {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}

import { InfoTip } from "@/components/common/info-tip"
import { cn } from "@/lib/utils"

/** Card surface: hairline border, 12px radius, optional resting shadow. */
export function Surface({
  children,
  className,
  elevated,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { elevated?: boolean; interactive?: boolean }) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-border bg-card text-card-foreground",
        elevated && "shadow-raised",
        interactive && "cursor-pointer transition-colors duration-100 hover:border-border-strong",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function SurfaceHeader({
  title,
  description,
  info,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  info?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-5 pt-4", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="flex items-center gap-1.5 text-body-3 font-semibold">
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </h3>
        {description && <p className="text-caption-1 text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

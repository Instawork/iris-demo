import { InfoTip } from "@/components/common/info-tip"
import { cn } from "@/lib/utils"

/** Page title with its explanation tucked into a tooltip, and page-level actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-[min(100%,20rem)] flex-1 flex-col gap-1">
        {eyebrow && <div className="text-caption-1 text-faded">{eyebrow}</div>}
        <h1 className="flex items-center gap-2 text-featured-1 font-semibold text-foreground">
          {title}
          {description && <InfoTip className="size-[18px] [&>svg]:size-4">{description}</InfoTip>}
        </h1>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({
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
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 className="flex items-center gap-1.5 text-featured-3 font-semibold">
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </h2>
        {description && <p className="text-caption-1 text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

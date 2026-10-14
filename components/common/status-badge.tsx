import { cn } from "@/lib/utils"

export type Tone = "neutral" | "primary" | "positive" | "warning" | "critical"

const FADED: Record<Tone, string> = {
  neutral: "bg-tint-faded text-faded ring-1 ring-inset ring-border",
  primary: "bg-foreground/[0.055] text-foreground ring-1 ring-inset ring-foreground/10",
  positive: "bg-positive-faded text-positive-fg ring-1 ring-inset ring-positive-border/80",
  warning: "bg-warning-faded text-warning-fg ring-1 ring-inset ring-warning-border/80",
  critical: "bg-critical-faded text-critical-fg ring-1 ring-inset ring-critical-border/80",
}

const OUTLINE: Record<Tone, string> = {
  neutral: "bg-background text-faded ring-1 ring-inset ring-border-strong/70",
  primary: "bg-background text-foreground ring-1 ring-inset ring-foreground/20",
  positive: "bg-background text-positive-fg ring-1 ring-inset ring-positive-border",
  warning: "bg-background text-warning-fg ring-1 ring-inset ring-warning-border",
  critical: "bg-background text-critical-fg ring-1 ring-inset ring-critical-border",
}

const DOT: Record<Tone, string> = {
  neutral: "bg-subtle",
  primary: "bg-foreground",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
}

/** Status pill: tinted fill with a hairline ring, optional leading dot. */
export function StatusBadge({
  tone = "neutral",
  children,
  dot,
  variant = "faded",
  size = "md",
  className,
}: {
  tone?: Tone
  children: React.ReactNode
  dot?: boolean
  variant?: "faded" | "outline"
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-caption-2" : "h-6 px-2 text-caption-1",
        variant === "faded" ? FADED[tone] : OUTLINE[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  )
}

export const toneText: Record<Tone, string> = {
  neutral: "text-faded",
  primary: "text-foreground",
  positive: "text-positive-fg",
  warning: "text-warning-fg",
  critical: "text-critical-fg",
}

export const toneBg: Record<Tone, string> = FADED

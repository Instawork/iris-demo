"use client"

import { Info } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Small (i) affordance that explains a term without adding words to the page. */
export function InfoTip({
  children,
  className,
  side = "top",
  label = "More info",
}: {
  children: React.ReactNode
  className?: string
  side?: "top" | "bottom" | "left" | "right"
  label?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none",
            className,
          )}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[280px] text-left leading-snug" sideOffset={6}>
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** Wraps any element with a tooltip. */
export function Tip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  className?: string
}) {
  if (!content) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className={cn("max-w-[300px] leading-snug", className)}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

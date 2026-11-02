"use client"

import { MotionConfig } from "motion/react"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeSync } from "@/hooks/use-theme"
import { useTour } from "@/hooks/use-tour"

export function Providers({ children }: { children: React.ReactNode }) {
  // The tour's steps in Agent Chat sit bottom right, so its toasts go to the other corner.
  const touring = useTour((s) => s.active)
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}>
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <ThemeSync />
        {children}
        <Toaster position={touring ? "bottom-left" : "bottom-right"} closeButton />
      </TooltipProvider>
    </MotionConfig>
  )
}

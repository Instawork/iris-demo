"use client"

import { MotionConfig } from "motion/react"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeSync } from "@/hooks/use-theme"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}>
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <ThemeSync />
        {children}
        <Toaster position="bottom-right" closeButton />
      </TooltipProvider>
    </MotionConfig>
  )
}

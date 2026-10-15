"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { AgentChat } from "@/components/agent/agent-chat"
import { Logo } from "@/components/brand/logo"
import { CommandPalette } from "@/components/shell/command-palette"
import { HelpDialog } from "@/components/shell/help-dialog"
import { SidebarContent, Sidebar } from "@/components/shell/sidebar"
import { Topbar } from "@/components/shell/topbar"
import { WelcomeDialog } from "@/components/shell/welcome-dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { UploadDialog } from "@/components/uploads/upload-dialog"
import { useUi } from "@/hooks/use-ui"
import { useStore } from "@/lib/store"

/** Same frame as the app, so the first paint already looks like CrUber while saved data loads. */
function BootFrame() {
  return (
    <div className="flex h-svh w-full overflow-hidden bg-page-faded" aria-busy="true" aria-label="Loading CrUber">
      <div className="hidden w-60 shrink-0 px-3 pt-3 md:block">
        <div className="flex h-9 items-center px-1.5">
          <Logo />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 p-2 md:pl-0">
        <div className="flex-1 rounded-xl border border-border bg-background shadow-raised" />
      </div>
    </div>
  )
}

function MobileNav() {
  const open = useUi((s) => s.mobileNavOpen)
  const setOpen = useUi((s) => s.setMobileNav)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="border-r-0 bg-page-faded p-0 data-[side=left]:w-64" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const ready = useStore((s) => s.ready)
  const workspaceId = useStore((s) => s.workspaceId)
  const pathname = usePathname()
  const mainRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [uiReady, setUiReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([useStore.persist.rehydrate(), useUi.persist.rehydrate()]).then(() => {
      if (cancelled) return
      useStore.getState().ensureFresh()
      setUiReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const id = window.setInterval(() => useStore.getState().tick(), 2200)
    return () => window.clearInterval(id)
  }, [ready])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        useUi.getState().togglePalette()
        return
      }
      const target = e.target
      if ((target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "?") {
        e.preventDefault()
        useUi.getState().openHelp()
      }
      if (e.key === "[") {
        e.preventDefault()
        useUi.getState().toggleSidebar()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname, workspaceId])

  if (!ready || !uiReady) return <BootFrame />

  return (
    <div className="flex h-svh w-full overflow-hidden bg-page-faded">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col p-2 md:pl-0">
        <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-raised">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 overflow-hidden">
            <div className="absolute inset-0 bg-dotted [mask-image:radial-gradient(ellipse_at_100%_0%,black,transparent_65%)] opacity-70 dark:opacity-40" />
            <div className="absolute -top-24 -right-24 size-72 rounded-full bg-brand/20 blur-3xl dark:bg-brand/10" />
          </div>
          <Topbar scrolled={scrolled} />
          {pathname === "/" ? (
            <main key={workspaceId} className="flex min-h-0 flex-1 flex-col">
              {children}
            </main>
          ) : (
            <main
              ref={mainRef}
              onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
              className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"
            >
              <div key={workspaceId} className="mx-auto w-full max-w-[1320px] px-5 pt-2 pb-16 sm:px-8">
                {children}
              </div>
            </main>
          )}
        </div>
      </div>
      <MobileNav />
      <HelpDialog />
      <UploadDialog />
      <CommandPalette />
      <WelcomeDialog />
      <AgentChat />
    </div>
  )
}

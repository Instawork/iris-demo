"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, CircleHelp, Menu, Moon, PanelLeft, Play, Plus, Search, Sun, Upload } from "lucide-react"
import { Fragment, useMemo } from "react"

import { SIDES, SideBadge } from "@/components/common/side-badge"
import { SECTION_LABELS, SETTINGS_LABELS } from "@/components/shell/nav-config"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useTheme } from "@/hooks/use-theme"
import { useTour } from "@/hooks/use-tour"
import { useUi } from "@/hooks/use-ui"
import { formatMonth } from "@/lib/dates"
import { findSupplier, position } from "@/lib/reference"
import { reportPages } from "@/lib/reports"
import { cn } from "@/lib/utils"

interface Crumb {
  label: string
  href?: string
}

function useCrumbs(): Crumb[] {
  const pathname = usePathname()
  const data = useData()
  const { ws } = useWorkspace()
  return useMemo(() => {
    const parts = pathname.split("/").filter(Boolean)
    if (!parts.length) return [{ label: "Dashboard" }]
    const [section, sub] = parts
    const root: Crumb = { label: SECTION_LABELS[section] ?? section, href: `/${section}` }
    if (section === "settings") return [{ label: "Settings" }, { label: SETTINGS_LABELS[sub] ?? "Settings" }]
    if (!sub) return [{ label: root.label }]
    if (section === "reports") return [{ label: root.label }, { label: reportPages(ws.kind).find((p) => p.id === sub)?.label ?? "Report" }]
    if (section === "shifts" && sub === "new") return [root, { label: "New shift" }]
    if (section === "agencies" && sub === "new") return [root, { label: "Add an agency" }]
    if (section === "units" && sub === "new") return [ws.kind === "compass" ? root : { label: "Work locations", href: "/settings/locations" }, { label: "Add a unit" }]
    if (section === "shifts") {
      const g = data.groups.find((x) => x.id === sub)
      return [root, { label: g ? g.name || position(g.positionId).name : "Shift" }]
    }
    if (section === "invoices" && sub === "groups") {
      const g = data.invoiceGroups.find((x) => x.id === parts[2])
      return [root, { label: g ? (g.month ? formatMonth(g.month) : g.name) : "Invoice group" }]
    }
    if (section === "invoices") {
      const inv = data.invoices.find((x) => x.id === sub)
      return [root, { label: inv ? `Invoice #${inv.number}` : "Invoice" }]
    }
    if (section === "procurement") return [root, { label: data.sourcing?.find((e) => e.id === sub)?.number ?? "Event" }]
    if (section === "agencies") return [ws.kind === "compass" ? root : { label: "Rate Cards", href: "/rates" }, { label: findSupplier(sub)?.name ?? "Agency" }]
    return [root, { label: sub }]
  }, [pathname, data, ws.kind])
}

export function Topbar({ scrolled }: { scrolled: boolean }) {
  const crumbs = useCrumbs()
  const { ws } = useWorkspace()
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const setMobileNav = useUi((s) => s.setMobileNav)
  const openHelp = useUi((s) => s.openHelp)
  const openUpload = useUi((s) => s.openUpload)
  const setPalette = useUi((s) => s.setPalette)

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-1.5 px-3">
      <Button variant="ghost" size="icon" className="text-faded md:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
        <Menu className="size-4" />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="hidden text-faded md:inline-flex" onClick={toggleSidebar} aria-label="Toggle sidebar">
            <PanelLeft className={cn("size-4 transition-transform duration-150", collapsed && "-scale-x-100")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="gap-2">
          {collapsed ? "Expand" : "Collapse"} sidebar <Kbd>[</Kbd>
        </TooltipContent>
      </Tooltip>
      <span className="mx-1 hidden h-4 w-px bg-border md:block" />
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-tour="side" className="mr-1 cursor-default">
            <SideBadge kind={ws.kind} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          You&apos;re seeing what {SIDES[ws.kind].noun} sees. {SIDES[ws.kind].does}
        </TooltipContent>
      </Tooltip>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle" />}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="truncate rounded-md px-1 text-body-3 text-faded transition-colors hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="truncate px-1 text-body-3 font-medium text-foreground">{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="hidden h-8 w-44 items-center gap-2 rounded-lg border border-border bg-tint-faded pr-1.5 pl-2.5 text-body-3 text-subtle transition-colors duration-100 outline-none hover:border-border-strong hover:text-faded focus-visible:ring-2 focus-visible:ring-ring/30 md:flex xl:w-64"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search or jump to</span>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </button>
        <Button variant="ghost" size="icon" className="text-faded md:hidden" onClick={() => setPalette(true)} aria-label="Search">
          <Search className="size-4" />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" className="h-8 gap-1.5 rounded-lg px-2.5 text-body-3 text-faded" onClick={() => useTour.getState().open()} aria-label="Guided tour">
              <Play className="size-3.5" />
              <span className="hidden lg:inline">Guided tour</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">A 5-minute walkthrough of Iris</TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-faded" onClick={() => openHelp()} aria-label="Help">
              <CircleHelp className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="gap-2">
            How Iris works <Kbd>?</Kbd>
          </TooltipContent>
        </Tooltip>
        {ws.kind === "buyer" ? (
          <Button asChild className="h-8 gap-1.5 rounded-lg px-3 text-body-3 font-semibold" data-tour="book">
            <Link href="/shifts/new">
              <Plus className="size-4" /> New shift
            </Link>
          </Button>
        ) : (
          <Button className="h-8 gap-1.5 rounded-lg px-3 text-body-3 font-semibold" onClick={() => openUpload()} data-tour="book">
            <Upload className="size-4" /> Upload CSV
          </Button>
        )}
      </div>
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border transition-opacity duration-150"
        style={{ opacity: scrolled ? 1 : 0 }}
      />
    </header>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="text-faded" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{dark ? "Light theme" : "Dark theme"}</TooltipContent>
    </Tooltip>
  )
}

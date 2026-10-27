"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Check, ChevronRight, ChevronsUpDown, LogOut, RefreshCcw, RotateCcw, Settings, SlidersHorizontal, UserRound } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Logo } from "@/components/brand/logo"
import { WorkspaceAvatar } from "@/components/brand/org-avatar"
import { Tip } from "@/components/common/info-tip"
import { ProAvatar } from "@/components/common/pro-avatar"
import { DemoControlsDialog } from "@/components/shell/demo-controls"
import { navFor, type NavItem } from "@/components/shell/nav-config"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useSwitchWorkspace } from "@/hooks/use-switch-workspace"
import { useUi } from "@/hooks/use-ui"
import { WORKSPACES, sublabelOf } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

const isActive = (pathname: string, item: NavItem) => {
  if (item.href === "/") return pathname === "/"
  if (item.id === "settings") return pathname.startsWith("/settings")
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function Badge({ count, collapsed }: { count: number; collapsed?: boolean }) {
  if (!count) return null
  if (collapsed) return <span className="absolute top-1 right-1 size-1.5 rounded-full bg-brand ring-2 ring-page-faded" />
  return (
    <motion.span
      key={count}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.14 }}
      className="relative ml-auto min-w-5 rounded-[5px] bg-brand px-1.5 text-center text-caption-1 leading-5 font-semibold text-brand-foreground tabular"
    >
      {count > 99 ? "99+" : count}
    </motion.span>
  )
}

function NavRow({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const data = useData()
  const { ws } = useWorkspace()
  const active = isActive(pathname, item)
  const count = item.badge ? item.badge(data, ws) : 0
  const Icon = item.icon
  const [open, setOpen] = useState(false)
  const expanded = open || active

  const rowClass = cn(
    "relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-body-3 font-medium text-faded outline-none transition-colors duration-100",
    "hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
    active && "text-nav-active-foreground hover:bg-transparent hover:text-nav-active-foreground",
    collapsed && "justify-center px-0",
  )
  const highlight = active && (
    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-nav-active" transition={{ type: "spring", stiffness: 700, damping: 50, mass: 0.6 }} />
  )
  const content = (
    <>
      {highlight}
      {Icon && <Icon className={cn("relative size-4 shrink-0 text-subtle transition-colors", active && "text-brand")} strokeWidth={1.9} />}
      {!collapsed && <span className="relative truncate">{item.label}</span>}
      {!collapsed && item.children && (
        <ChevronRight className={cn("relative ml-auto size-4 text-subtle transition-transform duration-150", expanded && "rotate-90")} />
      )}
      {!item.children && <Badge count={count} collapsed={collapsed} />}
    </>
  )

  if (item.children) {
    if (collapsed) {
      return (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger className={rowClass} aria-label={item.label}>
                {content}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="start" className="w-56">
            {item.children.map((c) => (
              <DropdownMenuItem key={c.id} asChild>
                <Link href={c.href} onClick={onNavigate}>
                  {c.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    return (
      <div className="flex flex-col">
        <button type="button" className={rowClass} onClick={() => setOpen((o) => !o)} aria-expanded={expanded}>
          {content}
        </button>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="overflow-hidden"
            >
              <div className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-l border-border pl-2.5">
                {item.children.map((c) => {
                  const childActive = pathname === c.href
                  return (
                    <Tooltip key={c.id}>
                      <TooltipTrigger asChild>
                        <Link
                          href={c.href}
                          onClick={onNavigate}
                          className={cn(
                            "relative flex h-7 items-center rounded-md px-2.5 text-body-3 text-faded transition-colors duration-100 hover:bg-hover hover:text-foreground",
                            childActive && "bg-foreground/[0.06] font-medium text-foreground",
                          )}
                        >
                          {c.label}
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right">{c.tooltip}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={item.href} className={rowClass} onClick={onNavigate} aria-current={active ? "page" : undefined}>
          {content}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className={cn(!collapsed && "max-w-[240px]")}>
        {collapsed ? item.label : item.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

const GROUPS: { label: string; kind: Workspace["kind"]; hint: string }[] = [
  { label: "Buyers", kind: "buyer", hint: "Post shifts, approve hours, review invoices" },
  { label: "Program", kind: "compass", hint: "Govern rates, suppliers and spend" },
  { label: "Suppliers", kind: "supplier", hint: "Fill shifts, onboard Pros, get paid" },
]

function WorkspaceSwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { ws } = useWorkspace()
  const switchWorkspace = useSwitchWorkspace()

  const switchTo = (next: Workspace) => {
    switchWorkspace(next)
    onNavigate?.()
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-hover",
              collapsed && "justify-center p-1",
            )}
            data-tour="workspace"
          >
            <WorkspaceAvatar ws={ws} size="md" />
            {!collapsed && (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-3 font-semibold">{ws.name}</span>
                  <span className="truncate text-caption-1 text-faded">{sublabelOf(ws)}</span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-subtle" />
              </>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Switch between buyer, Compass and supplier views</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-80 p-1.5">
        {GROUPS.map((g, gi) => (
          <DropdownMenuGroup key={g.kind}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-caption-1 font-medium text-subtle">
              <Tip content={g.hint} side="right">
                <span>{g.label}</span>
              </Tip>
            </DropdownMenuLabel>
            {WORKSPACES.filter((w) => w.kind === g.kind).map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => switchTo(w)} className="gap-3 rounded-md px-2 py-2">
                <WorkspaceAvatar ws={w} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-3 font-semibold">{w.name}</span>
                  <span className="truncate text-caption-1 text-faded">
                    {w.user.name} · {w.user.title}
                  </span>
                </span>
                {w.id === ws.id && <Check className="size-4 text-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { ws } = useWorkspace()
  const resetWelcome = useUi((s) => s.resetWelcome)
  const resetDemo = useStore((s) => s.resetDemo)
  const signOut = useStore((s) => s.signOut)
  const router = useRouter()
  const [confirmReset, setConfirmReset] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [first, last] = ws.user.name.split(" ")
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-hover",
            collapsed && "justify-center p-1",
          )}
        >
          <ProAvatar name={ws.user.name} size="sm" />
          {!collapsed && (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-3 font-semibold">{ws.user.name}</span>
                <span className="truncate text-caption-1 text-faded">{ws.user.title}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-subtle" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-64">
          <DropdownMenuLabel className="flex flex-col px-2 py-1.5">
            <span className="text-body-3 font-semibold">
              {first} {last}
            </span>
            <span className="text-caption-1 font-normal text-faded">{ws.user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/settings/team")}>
            <UserRound /> Your profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/settings/company")}>
            <Settings /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              resetWelcome()
              toast("Welcome tour reset", { description: "You'll see each workspace's welcome again." })
            }}
          >
            <RotateCcw /> Replay welcome
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setControlsOpen(true)}>
            <SlidersHorizontal /> Demo controls
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmReset(true)}>
            <RefreshCcw /> Reset demo data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This brings back the original shifts, timesheets, invoices and uploads, with dates relative to today, for everyone signed in. Anything booked or approved will be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await resetDemo()
                router.push("/")
                toast.success("Demo data reset")
              }}
            >
              Reset data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DemoControlsDialog open={controlsOpen} onOpenChange={setControlsOpen} />
    </>
  )
}

export function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { ws } = useWorkspace()
  const items = useMemo(() => navFor(ws), [ws])
  return (
    <div className={cn("flex h-full flex-col gap-1.5 overflow-hidden pt-3 pb-2", collapsed ? "px-2" : "px-3")}>
      <div className={cn("flex h-9 items-center px-1.5", collapsed && "justify-center px-0")}>
        <Link href="/" onClick={onNavigate} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30" aria-label="Iris home">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} />
      <nav className="relative min-h-0 flex-1 overflow-y-auto scrollbar-none" data-tour="nav">
        <div className="flex flex-col gap-0.5 py-3">
          {items.map((item) => (
            <NavRow key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>
      <UserMenu collapsed={collapsed} />
    </div>
  )
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  return (
    <aside className="relative hidden h-svh shrink-0 transition-[width] duration-150 ease-out md:block" style={{ width: collapsed ? 60 : 240 }}>
      <SidebarContent collapsed={collapsed} />
    </aside>
  )
}

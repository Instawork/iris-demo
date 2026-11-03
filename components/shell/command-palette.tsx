"use client"

import { Command as CommandPrimitive } from "cmdk"
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarDays,
  CalendarPlus,
  Clock,
  FileText,
  Keyboard,
  Laptop,
  Moon,
  PanelLeft,
  Scale,
  Search,
  ShieldCheck,
  Sun,
  Upload,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { SupplierLogo, WorkspaceAvatar } from "@/components/brand/org-avatar"
import { ProAvatar } from "@/components/common/pro-avatar"
import { navFor, settingsFor } from "@/components/shell/nav-config"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useSwitchWorkspace } from "@/hooks/use-switch-workspace"
import { useTheme } from "@/hooks/use-theme"
import { useUi } from "@/hooks/use-ui"
import { formatDay, todayISO } from "@/lib/dates"
import { money } from "@/lib/format"
import { inScope, invoiceTotal, prosFor } from "@/lib/metrics"
import { WORKSPACES, buyer, location, position, supplier } from "@/lib/reference"
import type { PersonaKind } from "@/lib/types"

interface Action {
  id: string
  label: string
  icon: LucideIcon
  href?: string
  upload?: boolean
}

const ACTIONS: Record<PersonaKind, Action[]> = {
  buyer: [
    { id: "book", label: "New shift", icon: CalendarPlus, href: "/shifts/new" },
    { id: "approve", label: "Approve hours", icon: Clock, href: "/timesheets" },
    { id: "compare", label: "Compare agency rates", icon: Scale, href: "/rates" },
    { id: "upload", label: "Upload a CSV", icon: Upload, upload: true },
  ],
  supplier: [
    { id: "fill", label: "Fill open spots", icon: UserRoundCheck, href: "/shifts" },
    { id: "submit", label: "Submit hours", icon: Clock, href: "/timesheets" },
    { id: "rates", label: "Update your rates", icon: BadgeDollarSign, href: "/procurement?tab=rates" },
    { id: "upload", label: "Upload a CSV", icon: Upload, upload: true },
  ],
  compass: [
    { id: "flagged", label: "Review anomalous invoices", icon: FileText, href: "/invoices?filter=flagged" },
    { id: "sourcing", label: "Compare agencies and negotiate rates", icon: BadgeDollarSign, href: "/procurement" },
    { id: "rates", label: "See live rate cards", icon: BadgeDollarSign, href: "/procurement?tab=rates" },
    { id: "compliance", label: "Check worker compliance", icon: ShieldCheck, href: "/professionals" },
    { id: "upload", label: "Upload business activity", icon: Upload, upload: true },
  ],
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[16%] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 shadow-overlay sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search Iris</DialogTitle>
        <DialogDescription className="sr-only">Jump to a page, a record or an action.</DialogDescription>
        {open && <PaletteBody onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const data = useData()
  const { ws, scope } = useWorkspace()
  const switchWorkspace = useSwitchWorkspace()
  const openUpload = useUi((s) => s.openUpload)
  const openHelp = useUi((s) => s.openHelp)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState("")
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const match = (...parts: (string | undefined)[]) => {
    if (!tokens.length) return true
    const haystack = parts.join(" ").toLowerCase()
    return tokens.every((t) => haystack.includes(t))
  }

  const run = (fn: () => void) => {
    onClose()
    fn()
  }
  const go = (href: string) => run(() => router.push(href))

  const pages = useMemo(
    () => [...navFor(ws).flatMap((item) => item.children ?? [item]), ...settingsFor(ws)],
    [ws],
  )
  const records = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (query.trim().length < 2) return { shifts: [], pros: [], invoices: [] }
    const hit = (...parts: (string | undefined)[]) => {
      const haystack = parts.join(" ").toLowerCase()
      return terms.every((t) => haystack.includes(t))
    }
    const today = todayISO()
    const shifts = data.groups.filter(
      (g) =>
        inScope(scope, g) &&
        !g.cancelledAt &&
        hit(g.code, position(g.positionId).name, location(g.locationId).name, supplier(g.supplierId).shortName, g.eventName, g.name),
    )
    const upcoming = shifts.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    const past = shifts.filter((g) => g.date < today).sort((a, b) => b.date.localeCompare(a.date))
    return {
      shifts: [...upcoming, ...past].slice(0, 6),
      pros: prosFor(data, scope)
        .filter((p) => hit(p.firstName, p.lastName, p.code, supplier(p.supplierId).shortName))
        .slice(0, 6),
      invoices: data.invoices.filter((i) => inScope(scope, i) && hit(i.number, supplier(i.supplierId).shortName, buyer(i.buyerId).name)).slice(0, 5),
    }
  }, [data, scope, query])
  const actions = ACTIONS[ws.kind].filter((a) => match(a.label))
  const pageHits = pages.filter((p) => match(p.label, p.tooltip))
  const workspaces = WORKSPACES.filter((w) => w.id !== ws.id && match(w.name, w.user.name, w.kind))
  const dark = resolvedTheme === "dark"
  const prefs = [
    { id: "theme", label: dark ? "Switch to light theme" : "Switch to dark theme", icon: dark ? Sun : Moon, terms: "theme appearance mode dark light", run: () => setTheme(dark ? "light" : "dark") },
    { id: "system", label: "Match system theme", icon: Laptop, terms: "theme appearance mode system auto", run: () => setTheme("system") },
    { id: "sidebar", label: "Collapse or expand sidebar", icon: PanelLeft, terms: "sidebar navigation", run: toggleSidebar, key: "[" },
    { id: "keys", label: "Keyboard shortcuts", icon: Keyboard, terms: "help shortcuts keys", run: () => openHelp("keys"), key: "?" },
  ].filter((p) => match(p.label, p.terms))

  return (
    <CommandPrimitive label="Command palette" loop shouldFilter={false} className="flex flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-faded" />
        <CommandPrimitive.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search shifts, workers and invoices, or jump to a page"
          className="h-full min-w-0 flex-1 bg-transparent text-body-2 text-foreground outline-none placeholder:text-subtle"
        />
        <Kbd>Esc</Kbd>
      </div>
      <CommandPrimitive.List className="max-h-[min(440px,60svh)] scroll-py-2 overflow-y-auto p-2 scrollbar-thin">
        <CommandPrimitive.Empty className="py-10 text-center text-body-3 text-faded">No results for “{query}”</CommandPrimitive.Empty>

        {actions.length > 0 && (
          <Group heading="Actions">
            {actions.map((a) => (
              <Item key={a.id} value={`action ${a.label}`} icon={<a.icon className="size-4" />} label={a.label} onSelect={() => (a.upload ? run(() => openUpload()) : go(a.href!))} />
            ))}
          </Group>
        )}

        {pageHits.length > 0 && (
          <Group heading="Go to">
            {pageHits.map((p) => {
              const Icon = p.icon
              return <Item key={p.id} value={`page ${p.label}`} icon={Icon ? <Icon className="size-4" /> : null} label={p.label} onSelect={() => go(p.href)} />
            })}
          </Group>
        )}

        {records.shifts.length > 0 && (
          <Group heading="Shifts">
            {records.shifts.map((g) => {
              const loc = location(g.locationId)
              return (
                <Item
                  key={g.id}
                  value={`shift ${g.code}`}
                  icon={<CalendarDays className="size-4" />}
                  label={`${g.name || position(g.positionId).name} · ${loc.name}`}
                  hint={`${formatDay(g.date, "EEE, MMM d")} · ${g.code}`}
                  onSelect={() => go(`/shifts/${g.id}`)}
                />
              )
            })}
          </Group>
        )}

        {records.pros.length > 0 && (
          <Group heading="Workers">
            {records.pros.map((p) => (
              <Item
                key={p.id}
                value={`pro ${p.code}`}
                icon={<ProAvatar pro={p} size="xs" />}
                label={`${p.firstName} ${p.lastName}`}
                hint={`${p.code} · ${supplier(p.supplierId).shortName}`}
                onSelect={() => go(`/professionals?pro=${p.id}`)}
              />
            ))}
          </Group>
        )}

        {records.invoices.length > 0 && (
          <Group heading="Invoices">
            {records.invoices.map((i) => (
              <Item
                key={i.id}
                value={`invoice ${i.number}`}
                icon={<SupplierLogo supplierId={i.supplierId} size="xs" />}
                label={i.number}
                hint={`${supplier(i.supplierId).shortName} · ${buyer(i.buyerId).name} · ${money(invoiceTotal(i))}`}
                onSelect={() => go(`/invoices/${i.id}`)}
              />
            ))}
          </Group>
        )}

        {workspaces.length > 0 && (
          <Group heading="Switch workspace">
            {workspaces.map((w) => (
              <Item
                key={w.id}
                value={`workspace ${w.name} ${w.user.name}`}
                icon={<WorkspaceAvatar ws={w} size="xs" />}
                label={w.name}
                hint={w.user.name}
                onSelect={() => run(() => switchWorkspace(w))}
              />
            ))}
          </Group>
        )}

        {prefs.length > 0 && (
          <Group heading="Preferences">
            {prefs.map((p) => (
              <Item key={p.id} value={`pref ${p.id}`} icon={<p.icon className="size-4" />} label={p.label} shortcut={p.key ? <Kbd>{p.key}</Kbd> : undefined} onSelect={() => run(p.run)} />
            ))}
          </Group>
        )}
      </CommandPrimitive.List>
      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-caption-1 text-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> to open
        </span>
        <span className="ml-auto">{ws.name}</span>
      </div>
    </CommandPrimitive>
  )
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle"
    >
      {children}
    </CommandPrimitive.Group>
  )
}

function Item({
  value,
  icon,
  label,
  hint,
  shortcut,
  onSelect,
}: {
  value: string
  icon: React.ReactNode
  label: string
  hint?: string
  shortcut?: React.ReactNode
  onSelect: () => void
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className="group flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-body-3 text-foreground outline-none select-none data-[selected=true]:bg-foreground/[0.06]"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-faded group-data-[selected=true]:text-foreground">{icon}</span>
      <span className="truncate">{label}</span>
      {hint && <span className="truncate text-caption-1 text-subtle">{hint}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {shortcut ?? <ArrowRight className="size-3.5 text-faded opacity-0 group-data-[selected=true]:opacity-100" />}
      </span>
    </CommandPrimitive.Item>
  )
}

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Copy, Download, FileSpreadsheet, KeyRound, Mail, MapPin, Plug, Plus, RefreshCw, ShieldCheck, Webhook } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo, WorkspaceAvatar } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { HubDiagram } from "@/components/shell/hub-diagram"
import { SETTINGS_LABELS, settingsFor } from "@/components/shell/nav-config"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, specsFor, templateCsv } from "@/lib/csv"
import { plural } from "@/lib/format"
import { POSITIONS, SUPPLIERS, buyer, city, locationsFor, requirementsFor, requirementLabel, supplier, teamFor, termsOf } from "@/lib/reference"
import type { Location, Position, Workspace } from "@/lib/types"

const ROLE_HINT: Record<string, string> = {
  Admin: "Everything, including team and billing settings",
  "Program admin": "Rates, agencies, policies and every buyer",
  "Approves orders": "Approves orders that run over a unit's budget",
  "Can book": "Book and edit shifts at assigned locations",
  "Can approve hours": "Approve, edit and dispute timesheets",
  Finance: "Invoices, invoice groups and payments",
  Compliance: "Worker compliance and agency insurance",
  Operations: "Fill shifts, manage workers and submit hours",
}

export function SettingsPage({ section }: { section: string }) {
  const { ws } = useWorkspace()
  const router = useRouter()
  const pages = settingsFor(ws)
  return (
    <>
      <PageHeader className="pt-4" title="Settings" />
      <PillTabs
        value={section}
        onChange={(v) => router.push(`/settings/${v}`)}
        items={pages.map((p) => ({ value: p.href.split("/")[2], label: p.label, tooltip: p.tooltip }))}
        className="self-start"
      />
      {section === "company" && <CompanySection ws={ws} />}
      {section === "locations" && <LocationsSection ws={ws} />}
      {section === "positions" && <PositionsSection />}
      {section === "team" && <TeamSection ws={ws} />}
      {section === "integrations" && <IntegrationsSection ws={ws} />}
      {!SETTINGS_LABELS[section] && (
        <p className="text-body-3 text-faded">
          That page doesn&apos;t exist. <Link href="/settings/company" className="text-primary hover:underline">Go to Company profile</Link>
        </p>
      )}
    </>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-[220px_1fr]">
      <dt className="flex items-center gap-1 text-body-3 text-faded">
        {label} {hint && <InfoTip>{hint}</InfoTip>}
      </dt>
      <dd className="text-body-3 font-medium">{children}</dd>
    </div>
  )
}

function CompanySection({ ws }: { ws: Workspace }) {
  const [prefs, setPrefs] = useState({ attention: true, digest: true, invoices: ws.kind !== "supplier", fills: ws.kind === "buyer" })
  const sup = ws.supplierId ? supplier(ws.supplierId) : undefined
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Surface elevated className="lg:col-span-2">
        <SurfaceHeader title="Organization" info="Shown to agencies and on invoices." />
        <div className="flex items-center gap-4 px-5 pt-4">
          <WorkspaceAvatar ws={ws} size="xl" />
          <div className="flex flex-col">
            <span className="text-featured-3 font-bold">{ws.name}</span>
            <span className="text-body-3 text-faded">{ws.kind === "buyer" ? `${buyer(ws.buyerId!).sector} · Compass Group` : ws.kind === "supplier" ? sup?.tagline : "Compass Group USA flexible labor program"}</span>
          </div>
        </div>
        <dl className="px-5 pt-2 pb-3">
          {ws.kind === "buyer" && (
            <>
              <Field label="Locations">{locationsFor(ws.buyerId).length} work locations</Field>
              <Field label="Program">Compass Group USA flexible labor program</Field>
              <Field label="Payment terms" hint="Set in each agency's contract with Compass.">Paid by ACH through Iris</Field>
            </>
          )}
          {ws.kind === "supplier" && sup && (
            <>
              <Field label="Markets">{sup.cityIds.map((c) => `${city(c).name}, ${city(c).state}`).join(" · ")}</Field>
              <Field label="Connection">{sup.integrationDetail}</Field>
              <Field label="Certificate of insurance" hint="Must stay current to keep receiving shifts.">
                <StatusBadge tone={sup.coiExpiresInDays <= 14 ? "critical" : sup.coiExpiresInDays <= 30 ? "warning" : "positive"}>
                  {sup.coiExpiresInDays <= 30 ? `Expires in ${sup.coiExpiresInDays} days` : "Valid"}
                </StatusBadge>
              </Field>
              <Field label="Contract with Compass">{`Net ${termsOf(sup.id).netDays} · ${termsOf(sup.id).vaPct}% VA · ${plural(termsOf(sup.id).years, "year")}`}</Field>
              <Field label="Remit to">{sup.contactEmail}</Field>
            </>
          )}
          {ws.kind === "compass" && (
            <>
              <Field label="Payment terms">Set in each agency&apos;s contract. See Contracts in Procurement</Field>
              <Field label="Required for every worker">Background check, I-9 and Compass orientation, plus food handler and alcohol certificates by position</Field>
            </>
          )}
          <Field label="Main contact">
            {ws.user.name} · {ws.user.email}
          </Field>
        </dl>
      </Surface>
      <Surface elevated>
        <SurfaceHeader title="Notifications" description="Email and in-app" />
        <div className="flex flex-col gap-1 px-5 pt-3 pb-4">
          {[
            { key: "attention", label: "Shifts that need attention", sub: "Under 80% filled within 3 days" },
            { key: "digest", label: "Daily digest", sub: "Approvals, invoices and fills at 7am" },
            { key: "invoices", label: "Anomalous invoices", sub: "When an invoice runs well above what other agencies would charge" },
            { key: "fills", label: "Fully staffed", sub: "When a shift is fully filled" },
          ].map((p) => (
            <label key={p.key} className="flex items-center justify-between gap-3 rounded-lg px-1 py-2.5">
              <span className="flex flex-col">
                <span className="text-body-3 font-semibold">{p.label}</span>
                <span className="text-caption-1 text-faded">{p.sub}</span>
              </span>
              <Switch
                checked={prefs[p.key as keyof typeof prefs]}
                onCheckedChange={(v) => {
                  setPrefs((s) => ({ ...s, [p.key]: v }))
                  toast.success(v ? `${p.label} on` : `${p.label} off`)
                }}
              />
            </label>
          ))}
        </div>
      </Surface>
    </div>
  )
}

function LocationsSection({ ws }: { ws: Workspace }) {
  const data = useData()
  const locations = locationsFor(ws.kind === "buyer" ? ws.buyerId : undefined)
  const columns: Column<Location>[] = [
    {
      id: "name",
      header: "Location",
      sortValue: (l) => l.name,
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-semibold">{l.name}</span>
          <span className="text-caption-1 text-faded">{l.kind}</span>
        </span>
      ),
    },
    ...(ws.kind === "compass" ? [{ id: "buyer", header: "Buyer", sortValue: (l: Location) => l.buyerId, cell: (l: Location) => buyer(l.buyerId).name } satisfies Column<Location>] : []),
    {
      id: "address",
      header: "Address",
      cell: (l) => (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5 text-subtle" />
          {l.address} {l.zip}
        </span>
      ),
    },
    { id: "cc", header: "Cost center", cell: (l) => <code className="font-mono text-caption-1">{l.costCenter}</code> },
    {
      id: "departments",
      header: "Departments",
      cell: (l) =>
        l.departments?.length ? (
          <Tip content={l.departments.map((d) => `${d.name} · ${d.costCenter}`).join(", ")}>
            <span>{plural(l.departments.length, "department")}</span>
          </Tip>
        ) : (
          <span className="text-faded">None</span>
        ),
    },
    {
      id: "suppliers",
      header: "Agencies available",
      info: "Agencies with at least one active rate in this city.",
      cell: (l) => (
        <span className="flex -space-x-1">
          {SUPPLIERS.filter((s) => data.rateCards.some((c) => c.supplierId === s.id && c.cityId === l.cityId && c.status === "active")).map((s) => (
            <SupplierLogo key={s.id} supplierId={s.id} size="sm" className="ring-2 ring-card" />
          ))}
        </span>
      ),
    },
    {
      id: "upcoming",
      header: "Upcoming shifts",
      align: "right",
      cell: (l) => data.groups.filter((g) => g.locationId === l.id && !g.cancelledAt && g.date >= new Date().toISOString().slice(0, 10)).length,
    },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" asChild>
          <Link href="/units/new?from=settings">
            <Plus /> Add a unit
          </Link>
        </Button>
      </div>
      <DataTable rows={locations} columns={columns} getRowId={(l) => l.id} />
    </div>
  )
}

function PositionsSection() {
  const columns: Column<Position>[] = [
    {
      id: "name",
      header: "Position",
      sortValue: (p) => p.name,
      cell: (p) => (
        <span className="flex flex-col">
          <span className="font-semibold">{p.name}</span>
          <span className="text-caption-1 text-faded">{p.category}</span>
        </span>
      ),
    },
    {
      id: "requirements",
      header: "Required to work",
      className: "whitespace-normal",
      info: "Iris checks these on every placement, from any agency.",
      cell: (p) => (
        <span className="flex flex-wrap gap-1">
          {requirementsFor([p.id]).map((r) => (
            <StatusBadge key={r} tone={r === "foodHandler" || r === "alcohol" ? "primary" : "neutral"} size="sm">
              <ShieldCheck className="size-3" /> {requirementLabel(r)}
            </StatusBadge>
          ))}
        </span>
      ),
    },
    { id: "duties", header: "Duties", className: "whitespace-normal", cell: (p) => <span className="line-clamp-2 min-w-64 max-w-md text-caption-1 text-faded">{p.duties}</span> },
    { id: "attire", header: "Attire", className: "whitespace-normal", cell: (p) => <span className="line-clamp-2 min-w-48 max-w-xs text-caption-1 text-faded">{p.attire}</span> },
  ]
  return <DataTable rows={POSITIONS} columns={columns} getRowId={(p) => p.id} />
}

function TeamSection({ ws }: { ws: Workspace }) {
  const [team, setTeam] = useState(() => teamFor(ws))
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState("")
  const roles = ws.kind === "supplier" ? ["Admin", "Operations", "Finance"] : ws.kind === "compass" ? ["Program admin", "Finance", "Compliance"] : ["Admin", "Can book", "Can approve hours", "Finance"]
  const [role, setRole] = useState(roles[1])
  return (
    <>
      <Surface elevated>
        <SurfaceHeader
          title={`${team.length} team members`}
          description="Who can book, approve and pay"
          actions={
            <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => setInviteOpen(true)}>
              <Plus className="size-4" /> Invite
            </Button>
          }
        />
        <ul className="flex flex-col px-3 pt-3 pb-3">
          {team.map((m) => (
            <li key={m.name} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-100 hover:bg-hover">
              <ProAvatar name={m.name} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-3 font-semibold">
                  {m.name} {m.name === ws.user.name && <span className="text-caption-1 font-normal text-faded">(you)</span>}
                </span>
                <span className="truncate text-caption-1 text-faded">{m.title}</span>
              </span>
              <span className="hidden text-caption-1 text-faded sm:block">{ROLE_HINT[m.role]}</span>
              <StatusBadge tone={m.role.includes("dmin") ? "primary" : "neutral"}>{m.role}</StatusBadge>
            </li>
          ))}
        </ul>
      </Surface>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>They&apos;ll get an email to join {ws.name} on Iris.</DialogDescription>
          </DialogHeader>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="h-10 rounded-lg border border-input px-3 text-body-3 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-10 w-full rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {r} · <span className="text-faded">{ROLE_HINT[r]}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)}
              onClick={() => {
                const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                setTeam((t) => [...t, { name, title: "Invited", role }])
                toast.success(`Invite sent to ${email}`)
                setEmail("")
                setInviteOpen(false)
              }}
            >
              <Mail className="size-4" /> Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function IntegrationsSection({ ws }: { ws: Workspace }) {
  const data = useData()
  const [copied, setCopied] = useState(false)
  const flows = ["Shift requests", "Worker assignments", "Clock-ins", "Timesheets", "Invoices"]
  if (ws.kind === "supplier") {
    const sup = supplier(ws.supplierId!)
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Surface elevated className="p-5">
          <div className="flex items-center gap-3">
            <SupplierLogo supplierId={sup.id} size="lg" />
            <div className="flex flex-col">
              <span className="text-body-2 font-bold">Your connection</span>
              <span className="text-body-3 text-faded">{sup.integrationDetail}</span>
            </div>
          </div>
          {sup.integration === "api" ? (
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-body-3 font-semibold">
                  <KeyRound className="size-4 text-faded" /> API key
                </span>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-page-faded px-3 py-2 font-mono text-caption-1">
                  <span className="flex-1 truncate">iris_live_{sup.id}_••••••••••••••••4f2a</span>
                  <Button size="icon-sm" variant="ghost" aria-label="Rotate key" onClick={() => toast.success("Key rotated", { description: "The old key keeps working for 24 hours." })}>
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-body-3 font-semibold">
                  <Webhook className="size-4 text-faded" /> Webhook
                </span>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-page-faded px-3 py-2 font-mono text-caption-1">
                  <span className="flex-1 truncate">https://hooks.iris.app/v1/{sup.id}/events</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Copy webhook"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`https://hooks.iris.app/v1/${sup.id}/events`)
                      setCopied(true)
                      window.setTimeout(() => setCopied(false), 1400)
                    }}
                  >
                    {copied ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
              </div>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {flows.map((f) => (
                  <StatusBadge key={f} tone="positive" size="sm">
                    <Check className="size-3" /> {f}
                  </StatusBadge>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-3">
              <p className="flex items-center gap-1.5 text-caption-1 text-faded">
                CSV templates
                <InfoTip>Upload these with Upload CSV at the top of any page, or drop them on our SFTP folder. Templates come prefilled with your shifts and workers.</InfoTip>
              </p>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {specsFor("supplier").map((s) => (
                  <li key={s.type} className="flex items-center justify-between px-3 py-2.5 text-body-3">
                    <span className="flex items-center gap-2">
                      <FileSpreadsheet className="size-4 text-positive" /> {s.label}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-caption-1" onClick={() => downloadCsv(`iris-${s.type}-template.csv`, templateCsv(s.type, data, ws))}>
                      <Download className="size-3.5" /> Template
                    </Button>
                  </li>
                ))}
              </ul>
              <Button className="h-9 gap-1.5 self-start rounded-lg text-body-3" onClick={() => toast.success("Request sent", { description: "Your Iris partner manager will set up an API key with you." })}>
                <Plug className="size-4" /> Switch to API
              </Button>
            </div>
          )}
        </Surface>
        <Surface elevated className="flex flex-col">
          <SurfaceHeader title="How it connects" />
          <div className="flex flex-1 items-center px-3 pb-3">
            <HubDiagram className="w-full" />
          </div>
        </Surface>
      </div>
    )
  }
  return (
    <>
      <Surface elevated className="overflow-hidden">
        <SurfaceHeader title="One connection to every agency" info="Every agency connects to Iris once, by API or CSV. You never integrate with them one by one." />
        <div className="px-4 pb-4">
          <HubDiagram />
        </div>
      </Surface>
      <div className="grid gap-4 md:grid-cols-2">
        {SUPPLIERS.map((s) => (
          <div key={s.id}>
            <Surface elevated className="flex h-full flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <SupplierLogo supplierId={s.id} size="lg" />
                  <div className="flex flex-col">
                    <span className="text-body-2 font-bold">{s.name}</span>
                    <span className="text-caption-1 text-faded">{s.integration === "api" ? "API · syncs hourly" : "CSV uploads · next morning"}</span>
                  </div>
                </div>
                <StatusBadge tone="positive" dot>
                  Connected
                </StatusBadge>
              </div>
              <ul className="flex flex-col gap-1.5">
                {flows.map((f) => {
                  const live = s.integration === "api" || f === "Shift requests"
                  return (
                    <li key={f} className="flex items-center justify-between text-body-3">
                      <span>{f}</span>
                      <span className={live ? "inline-flex items-center gap-1 text-caption-1 font-semibold text-positive-fg" : "inline-flex items-center gap-1 text-caption-1 text-faded"}>
                        {live ? <Check className="size-3.5" /> : <FileSpreadsheet className="size-3.5" />}
                        {live ? (s.integration === "api" ? "Automatic" : "Sent instantly") : "By CSV"}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-auto text-caption-1 text-subtle">{s.integrationDetail}</p>
            </Surface>
          </div>
        ))}
      </div>
    </>
  )
}

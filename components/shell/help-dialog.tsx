"use client"

import { BadgeCheck, CalendarPlus, Coins, Keyboard, Scale, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PillTabs } from "@/components/common/pill-tabs"
import { GLOSSARY } from "@/components/shell/glossary"
import { HubDiagram } from "@/components/shell/hub-diagram"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import type { PersonaKind } from "@/lib/types"

const STEPS: Record<PersonaKind, { icon: typeof CalendarPlus; title: string; body: string }[]> = {
  buyer: [
    { icon: Scale, title: "Approve your suppliers", body: "Compare rates and track records on Supplier Rates, then open the suppliers you trust and approve them." },
    { icon: CalendarPlus, title: "Post a shift", body: "Pick a location, position and time. Every approved supplier is notified at once." },
    { icon: BadgeCheck, title: "Approve the hours", body: "Approve hours on Timesheets. Approving them generates the supplier's invoice." },
    { icon: Coins, title: "Review invoices", body: "Every invoice is built from approved hours, tips and the supplier's rate. Nobody uploads them." },
  ],
  supplier: [
    { icon: Scale, title: "Upload rates and Pros", body: "Upload your rates by city and your Pros by CSV, or connect by API. An agent proposes fixes before anything saves." },
    { icon: CalendarPlus, title: "Get approved, get shifts", body: "Buyers that approve you are sent to you every time they post a shift." },
    { icon: BadgeCheck, title: "Place compliant Pros", body: "Only Pros with current documents can be assigned. Their profile shows exactly what's missing." },
    { icon: Coins, title: "Submit hours, get paid", body: "Submit hours and tips. Approved hours become your invoice automatically." },
  ],
  compass: [
    { icon: CalendarPlus, title: "Watch spend", body: "Every location ranked by spend, with the ones far above their normal week flagged." },
    { icon: Scale, title: "Rank suppliers", body: "Suppliers scored on fill rate, no-shows, compliance and time to fill." },
    { icon: BadgeCheck, title: "Review anomalies", body: "Invoices much higher than other suppliers would have charged, weighted by rating, become your todos." },
    { icon: Coins, title: "Upload business activity", body: "Events, meals served and revenue by location, stored to compare against labor spend later." },
  ],
}

type HelpTab = "how" | "glossary" | "keys"

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen)
  const close = useUi((s) => s.closeHelp)
  const topic = useUi((s) => s.helpTopic)
  const session = useUi((s) => s.helpSession)
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="max-h-[88svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <HelpBody key={session} initialTab={topic === "keys" || topic === "glossary" ? topic : "how"} />
      </DialogContent>
    </Dialog>
  )
}

function HelpBody({ initialTab }: { initialTab: HelpTab }) {
  const { ws } = useWorkspace()
  const [tab, setTab] = useState<HelpTab>(initialTab)
  const [query, setQuery] = useState("")
  const terms = useMemo(
    () => GLOSSARY.filter((t) => `${t.term} ${t.definition}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  )
  return (
    <>
        <DialogHeader className="gap-1 border-b border-border px-6 pt-6 pb-4">
          <DialogTitle className="text-featured-3 font-bold">How Iris works</DialogTitle>
          <DialogDescription className="text-body-3">
            Six pages, the same for everyone: Dashboard, Shifts, Supplier Rates, Professionals, Invoices and Uploads.
          </DialogDescription>
          <PillTabs
            className="mt-3"
            value={tab}
            onChange={setTab}
            items={[
              { value: "how", label: "The basics" },
              { value: "glossary", label: "Glossary", count: GLOSSARY.length },
              { value: "keys", label: "Shortcuts" },
            ]}
          />
        </DialogHeader>
        <div className="max-h-[60svh] overflow-y-auto px-6 py-5 scrollbar-thin">
          {tab === "how" && (
            <div className="flex flex-col gap-5">
              <div className="rounded-xl border border-border bg-page-faded">
                <HubDiagram />
              </div>
              <ol className="grid gap-3 sm:grid-cols-2">
                {STEPS[ws.kind].map((s, i) => (
                  <li key={s.title} className="flex gap-3 rounded-lg border border-border p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-faded text-primary">
                      <s.icon className="size-4" />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-caption-1 font-semibold text-faded">Step {i + 1}</span>
                      <span className="text-body-3 font-bold">{s.title}</span>
                      <span className="text-body-3 text-faded">{s.body}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {tab === "glossary" && (
            <div className="flex flex-col gap-3">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-input px-3">
                <Search className="size-4 text-subtle" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search terms like markup or fill rate"
                  className="w-full bg-transparent text-body-3 outline-none placeholder:text-subtle"
                />
              </div>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {terms.map((t) => (
                  <div key={t.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
                    <dt className="flex flex-col">
                      <span className="text-body-3 font-bold">{t.term}</span>
                      <span className="text-caption-1 text-subtle">{t.group}</span>
                    </dt>
                    <dd className="text-body-3 text-faded">{t.definition}</dd>
                  </div>
                ))}
                {terms.length === 0 && <p className="px-4 py-6 text-center text-body-3 text-faded">No terms match.</p>}
              </dl>
            </div>
          )}
          {tab === "keys" && (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {[
                ["Search and jump anywhere", ["⌘", "K"]],
                ["Open this help", ["?"]],
                ["Collapse or expand the sidebar", ["["]],
                ["Close any dialog", ["Esc"]],
              ].map(([label, keys]) => (
                <div key={label as string} className="flex items-center justify-between px-4 py-3 text-body-3">
                  <span className="flex items-center gap-2">
                    <Keyboard className="size-4 text-subtle" />
                    {label}
                  </span>
                  <span className="flex gap-1">
                    {(keys as string[]).map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
    </>
  )
}

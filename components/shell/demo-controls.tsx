"use client"

import { CalendarCheck, Copy, ExternalLink, Smartphone } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useData } from "@/hooks/use-app"
import { plural } from "@/lib/format"
import { PROGRAM, SUPPLIERS } from "@/lib/reference"
import { useStore } from "@/lib/store"

/** Presenter switches for the shared demo: which agencies Iris staffs on its own, and a live shift to clock out of. */
export function DemoControlsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const setAutoFill = useStore((s) => s.setAgencyAutoFill)
  const closeWeekNow = useStore((s) => s.closeWeekNow)
  const paused = new Set(data.settings?.pausedAgencies ?? [])
  const [link, setLink] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [closing, setClosing] = useState(false)
  const openInvoices = data.invoices.filter((i) => i.status === "open" && i.lines.length > 0)

  const closeWeek = async () => {
    setClosing(true)
    const numbers = await closeWeekNow()
    setClosing(false)
    if (numbers.length) toast.success(`Iris issued ${plural(numbers.length, "invoice")}`, { description: `${numbers.join(", ")}, due in ${PROGRAM.paymentTermsDays} days.` })
  }

  const startLive = async () => {
    setStarting(true)
    const res = await fetch("/api/demo/live-shift", { method: "POST" })
    const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string }
    setStarting(false)
    if (!res.ok || !body.path) {
      toast.error(body.error ?? "Iris couldn't start the live shift.")
      return
    }
    setLink(new URL(body.path, window.location.origin).href)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Demo controls</DialogTitle>
          <DialogDescription>
            Iris staffs released shifts for agencies nobody is signed in as, so they fill on their own. Turn an agency off to staff its shifts by hand. Anyone signed in as an agency always
            staffs it themselves.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {SUPPLIERS.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <SupplierLogo supplierId={s.id} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-3 font-semibold">{s.shortName}</span>
                <span className="truncate text-caption-1 text-faded">{paused.has(s.id) ? "Staffed by hand" : "Iris staffs it when nobody is signed in"}</span>
              </span>
              <Switch checked={!paused.has(s.id)} onCheckedChange={(on) => void setAutoFill(s.id, on)} aria-label={`Automatic staffing for ${s.shortName}`} />
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span className="flex items-center gap-2 text-body-3 font-semibold">
            <Smartphone className="size-4 text-faded" /> Live check-in
          </span>
          <span className="text-caption-1 text-faded">
            A bartender shift at West Loop Arena that started an hour ago, with a Crewline bartender clocked in. Open the link on a phone and clock out: Iris creates the timesheet from the punch and it lands on Timesheets for Levy.
          </span>
          {link ? (
            <div className="flex flex-col gap-2">
              <code className="truncate rounded-md bg-tint-faded px-2 py-1.5 font-mono text-caption-1">{link}</code>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-8 gap-1.5 rounded-lg text-caption-1"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link)
                    toast.success("Check-in link copied")
                  }}
                >
                  <Copy className="size-3.5" /> Copy link
                </Button>
                <Button asChild variant="ghost" className="h-8 gap-1.5 rounded-lg text-caption-1">
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" /> Open
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="h-8 self-start rounded-lg text-caption-1" disabled={starting} onClick={startLive}>
              {starting ? "Starting…" : "Start a live shift"}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span className="flex items-center gap-2 text-body-3 font-semibold">
            <CalendarCheck className="size-4 text-faded" /> Close the week
          </span>
          <span className="text-caption-1 text-faded">
            Approved hours collect on each agency&apos;s open invoice until the week closes on Friday, and Iris issues them on Saturday. Close it now to issue{" "}
            {openInvoices.length ? plural(openInvoices.length, "open invoice") : "this week's invoices"} during the demo.
          </span>
          <Button variant="outline" className="h-8 self-start rounded-lg text-caption-1" disabled={closing || !openInvoices.length} onClick={closeWeek}>
            {closing ? "Issuing…" : openInvoices.length ? "Close the week now" : "No open invoices yet"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

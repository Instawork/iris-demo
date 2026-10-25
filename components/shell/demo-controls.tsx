"use client"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useData } from "@/hooks/use-app"
import { SUPPLIERS } from "@/lib/reference"
import { useStore } from "@/lib/store"

/** Presenter switches for the shared demo: which agencies Iris staffs on its own when nobody is playing them. */
export function DemoControlsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const setAutoFill = useStore((s) => s.setAgencyAutoFill)
  const paused = new Set(data.settings?.pausedAgencies ?? [])
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
      </DialogContent>
    </Dialog>
  )
}

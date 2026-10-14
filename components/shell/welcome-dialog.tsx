"use client"

import { ArrowRight, Check } from "lucide-react"

import { HubDiagram } from "@/components/shell/hub-diagram"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import type { PersonaKind } from "@/lib/types"

const COPY: Record<PersonaKind, { lead: string; points: string[] }> = {
  buyer: {
    lead: "Post shifts to Instawork and the other agencies you approve, without a ticketing maze.",
    points: [
      "Approve suppliers on your Dashboard after comparing rates and track records",
      "Post a shift once and every approved supplier is notified",
      "Approve hours on Shifts and CrUber generates the invoice",
    ],
  },
  supplier: {
    lead: "Fill Compass shifts, keep your Pros compliant and get paid faster.",
    points: [
      "See shifts from buyers that approved you and assign compliant Pros",
      "Upload rates, Pros, timesheets and tips as CSV, or connect by API",
      "Approved hours become your invoice automatically",
    ],
  },
  compass: {
    lead: "See every buyer, supplier and dollar in the flexible labor program.",
    points: [
      "Buyer spend and supplier rankings on one Dashboard",
      "Anomalous invoices flagged against what other suppliers would have charged",
      "Upload business activity by location to compare with labor spend later",
    ],
  },
}

export function WelcomeDialog() {
  const { ws } = useWorkspace()
  const seen = useUi((s) => !!s.welcomeSeen[ws.kind])
  const mark = useUi((s) => s.markWelcome)
  const copy = COPY[ws.kind]
  return (
    <Dialog open={!seen} onOpenChange={(o) => (!o ? mark(ws.kind) : undefined)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <div className="border-b border-border bg-page-faded/60 px-4 pt-2">
          <HubDiagram className="py-6" />
        </div>
        <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-featured-2 font-semibold">Welcome to CrUber, {ws.user.firstName}</DialogTitle>
            <DialogDescription className="text-body-3 text-faded">{copy.lead}</DialogDescription>
          </div>
          <ul className="flex flex-col gap-2.5">
            {copy.points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-body-3">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-strong" />
                {p}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-caption-1 text-subtle">Switch between buyer, Compass and supplier views from the top of the sidebar.</p>
            <Button className="h-9 shrink-0 gap-1.5 rounded-lg px-3.5 text-body-3" onClick={() => mark(ws.kind)}>
              Get started <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

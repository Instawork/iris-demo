"use client"

import { Check, Play } from "lucide-react"

import { HubDiagram } from "@/components/shell/hub-diagram"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useWorkspace } from "@/hooks/use-app"
import { useTour } from "@/hooks/use-tour"
import { useUi } from "@/hooks/use-ui"
import type { PersonaKind } from "@/lib/types"

const COPY: Record<PersonaKind, { lead: string; points: string[] }> = {
  buyer: {
    lead: "Compare every agency's rates, pick the best offer and post shifts once, without a ticketing maze.",
    points: [
      "Compare each agency's rate for a role on Rate Cards and pick who sees it first",
      "Post a shift once and every approved supplier is notified",
      "Approve hours on Timesheets and Iris generates the invoice",
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
  const touring = useTour((s) => s.active)
  const copy = COPY[ws.kind]
  return (
    <Dialog open={!seen && !touring} onOpenChange={(o) => (!o ? mark(ws.kind) : undefined)}>
      <DialogContent className="grid-cols-1 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <div className="border-b border-border bg-page-faded/60 px-4 pt-2">
          <HubDiagram className="py-6" />
        </div>
        <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-featured-2 font-semibold">Welcome to Iris, {ws.user.firstName}</DialogTitle>
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
          <p className="text-caption-1 text-subtle">Switch between buyer, Compass and supplier views from the top of the sidebar.</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" className="h-9 rounded-lg px-3.5 text-body-3" onClick={() => mark(ws.kind)}>
              Explore on my own
            </Button>
            <Button
              className="h-9 gap-1.5 rounded-lg px-3.5 text-body-3"
              onClick={() => {
                mark(ws.kind)
                useTour.getState().open()
              }}
            >
              <Play className="size-3.5 fill-current" /> Take the 5-minute tour
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

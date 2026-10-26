"use client"

import { TrendingDown } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Surface, SurfaceHeader } from "@/components/common/surface"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { money, plural } from "@/lib/format"
import { city, position } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { RateCard } from "@/lib/types"

/** The agency's side of a rate review: lower a bill rate to the market, or keep it and tell Compass why. */
export function RateReviews({ cards }: { cards: RateCard[] }) {
  const answer = useStore((s) => s.answerRateReview)
  const [keeping, setKeeping] = useState<RateCard>()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const lower = async (c: RateCard) => {
    setBusy(true)
    const ok = await answer(c.id, "lower")
    setBusy(false)
    if (ok) toast.success(`${position(c.positionId).name} in ${city(c.cityId).name} lowered to ${money(target(c))}/hr`, { description: "New shifts price at the new rate. Shifts already released keep theirs." })
  }

  const keep = async () => {
    if (!keeping || !note.trim()) return
    setBusy(true)
    const ok = await answer(keeping.id, "keep", note.trim())
    setBusy(false)
    if (!ok) return
    toast(`Kept your ${position(keeping.positionId).name} rate`, { description: "Compass sees your reason on the invoice." })
    setKeeping(undefined)
  }

  return (
    <Surface elevated data-tour="rate-reviews">
      <SurfaceHeader
        title={`Compass asked you to review ${plural(cards.length, "rate")}`}
        description="These bill rates run above what the other agencies charge for the same city and role, weighted by rating. Lower to the market rate, or keep yours and say why. New shifts price at your answer."
      />
      <ul className="flex flex-col px-5 pb-3">
        {cards.map((c) => {
          const r = c.rateReview!
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-border/80 py-3 first:border-t-0">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-body-3">
                <span className="font-semibold">
                  {position(c.positionId).name} · {city(c.cityId).name}
                </span>
                <span className="text-caption-1 text-faded">
                  Yours {money(r.fromRate)}/hr, market {money(r.marketRate)}/hr. Asked by {r.requestedBy}
                  {r.note ? `: “${r.note}”` : "."}
                </span>
              </span>
              <Button
                variant="outline"
                className="h-8 rounded-lg text-body-3"
                onClick={() => {
                  setNote("")
                  setKeeping(c)
                }}
              >
                Keep mine
              </Button>
              <Button className="h-8 gap-1.5 rounded-lg text-body-3 font-semibold" disabled={busy} onClick={() => lower(c)}>
                <TrendingDown className="size-4" /> Lower to {money(target(c))}/hr
              </Button>
            </li>
          )
        })}
      </ul>

      <Dialog open={!!keeping} onOpenChange={(o) => !o && setKeeping(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keep your {keeping ? position(keeping.positionId).name.toLowerCase() : ""} rate?</DialogTitle>
            <DialogDescription>Tell Compass why it should stay. They see your reason next to the invoice they flagged.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: every bartender we send holds a BASSET card and two years at stadium bars." className="min-h-24 rounded-lg text-body-3" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKeeping(undefined)}>
              Cancel
            </Button>
            <Button disabled={busy || !note.trim()} onClick={keep}>
              Keep my rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Surface>
  )
}

/** A bill rate never goes below what the Pro is paid. */
const target = (c: RateCard) => Math.max(c.rateReview?.marketRate ?? c.billRate, c.proRate)

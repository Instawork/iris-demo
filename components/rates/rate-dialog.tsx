"use client"

import { MapPin } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { InfoTip } from "@/components/common/info-tip"
import { RateBreakdown } from "@/components/shifts/shift-detail"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { billFrom, markupFrom, money } from "@/lib/format"
import { CITIES, POSITIONS, city, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { RateCard } from "@/lib/types"

const numberInput =
  "h-10 w-full rounded-lg border border-input bg-card pr-3 pl-7 text-body-3 font-semibold tabular outline-none transition-shadow focus:border-primary/60 focus:ring-2 focus:ring-primary/15"

/** Pay rate, markup and bill rate stay in sync: edit any two and the third follows. */
export function RateDialog({
  open,
  onOpenChange,
  supplierId,
  card,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplierId: string
  card?: RateCard
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <RateForm key={card?.id ?? "new"} supplierId={supplierId} card={card} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RateForm({ supplierId, card, onClose }: { supplierId: string; card?: RateCard; onClose: () => void }) {
  const upsert = useStore((s) => s.upsertRateCard)
  const sup = supplier(supplierId)
  const [cityId, setCityId] = useState(card?.cityId ?? sup.cityIds[0])
  const [positionId, setPositionId] = useState(card?.positionId ?? POSITIONS[0].id)
  const [pro, setPro] = useState(card ? String(card.proRate) : "")
  const [markup, setMarkup] = useState(String(card?.markupPct ?? sup.profile.markupPct))
  const [bill, setBill] = useState(card ? String(card.billRate) : "")
  const [zips, setZips] = useState(card && !card.zipsAutoFilled ? card.zips.join(", ") : "")

  const proN = Number(pro)
  const markupN = Number(markup)
  const billN = Number(bill)
  const valid = proN >= 7.25 && billN > proN && markupN > 0
  const zipList = zips.split(/[\s,;]+/).map((z) => z.trim()).filter(Boolean)
  const badZips = zipList.filter((z) => !/^\d{5}$/.test(z))

  const save = () => {
    upsert({
      id: card?.id,
      supplierId,
      cityId,
      positionId,
      proRate: proN,
      billRate: billN,
      markupPct: markupN,
      zips: zipList.length ? zipList : city(cityId).zips,
      zipsAutoFilled: !zipList.length,
      source: "manual",
    })
    toast.success("Rate saved", {
      description: `${POSITIONS.find((p) => p.id === positionId)?.name}, ${city(cityId).name}: ${money(billN)}/hr`,
    })
    onClose()
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>{card ? "Edit rate" : "Add a rate"}</DialogTitle>
          <DialogDescription>Enter any two of pay rate, markup and bill rate. The third fills itself in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-body-3 font-semibold">City</span>
            <Select value={cityId} onValueChange={setCityId} disabled={!!card}>
              <SelectTrigger className="h-10 w-full rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CITIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}, {c.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body-3 font-semibold">Position</span>
            <Select value={positionId} onValueChange={setPositionId} disabled={!!card}>
              <SelectTrigger className="h-10 w-full rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-body-3 font-semibold">
              Pay rate <InfoTip>What the worker earns per hour.</InfoTip>
            </span>
            <span className="relative">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-body-3 text-faded">$</span>
              <input
                inputMode="decimal"
                value={pro}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, "")
                  setPro(v)
                  if (Number(v) && Number(markup)) setBill(String(billFrom(Number(v), Number(markup))))
                }}
                className={numberInput}
                placeholder="19.75"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-body-3 font-semibold">
              Markup <InfoTip>What you keep on top of the pay rate, as a percent of the pay rate.</InfoTip>
            </span>
            <span className="relative">
              <input
                inputMode="decimal"
                value={markup}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, "")
                  setMarkup(v)
                  if (Number(v) && Number(pro)) setBill(String(billFrom(Number(pro), Number(v))))
                }}
                className={`${numberInput} pl-3`}
                placeholder="32"
              />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-body-3 text-faded">%</span>
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-body-3 font-semibold">
              Bill rate <InfoTip>What the buyer pays per hour, all in.</InfoTip>
            </span>
            <span className="relative">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-body-3 text-faded">$</span>
              <input
                inputMode="decimal"
                value={bill}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, "")
                  setBill(v)
                  if (Number(v) && Number(pro) && Number(v) > Number(pro)) setMarkup(String(markupFrom(Number(pro), Number(v))))
                }}
                className={numberInput}
                placeholder="26.07"
              />
            </span>
          </label>
        </div>
        {valid && <RateBreakdown proRate={proN} billRate={billN} markupPct={markupN} />}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-body-3 font-semibold">
            Zip codes <span className="font-normal text-faded">(optional)</span>
          </span>
          <Textarea value={zips} onChange={(e) => setZips(e.target.value)} placeholder={`Leave blank to cover every ${city(cityId).name} zip code`} className="min-h-16 rounded-lg text-body-3" />
          <span className="flex items-center gap-1 text-caption-1 text-faded">
            <MapPin className="size-3.5" />
            {zipList.length ? `${zipList.length} zip code${zipList.length === 1 ? "" : "s"}` : `We'll fill in all ${city(cityId).zips.length} ${city(cityId).name} zip codes`}
            {badZips.length > 0 && <span className="text-critical-fg"> · {badZips.join(", ")} isn&apos;t valid</span>}
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || badZips.length > 0}>
            Save rate
          </Button>
        </DialogFooter>
    </>
  )
}

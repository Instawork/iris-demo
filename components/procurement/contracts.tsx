"use client"

import { useRouter } from "next/navigation"
import { ChevronRight } from "lucide-react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { moneyYear } from "@/components/procurement/sourcing-bits"
import { useData } from "@/hooks/use-app"
import { pct } from "@/lib/format"
import { SUPPLIERS, vaTier } from "@/lib/reference"
import { latestBid, termsNow, yearlySpend } from "@/lib/sourcing"
import type { ContractTerms, SourcingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Every agency's contract with Compass in one table: what Compass spends with it, the VA it pays back at year end, its
 * payment terms and how long the contract runs. Terms offered in an open event show under the ones in force, so a
 * renewal reads at a glance.
 */

const years = (n: number) => `${n} yr${n === 1 ? "" : "s"}`

const th = "px-3 pb-2.5 font-medium whitespace-nowrap"

function Offered({ value, now, ev, better }: { value: string; now: string; ev?: SourcingEvent; better?: boolean }) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-medium tabular">{now}</span>
      {ev && value !== now && (
        <Tip content={`Offered in ${ev.number}`}>
          <span className={cn("text-caption-1 whitespace-nowrap", better ? "text-positive-fg" : "text-faded")}>{value} offered</span>
        </Tip>
      )}
    </span>
  )
}

const tierLine = (tiers: [number, number][]) =>
  tiers.map(([from, pct], i) => (i === 0 ? `${pct}%` : `${pct}% from ${moneyYear(from)}`)).join(" · ")

/** The VA tier the agency's spend reaches, the next one up, and a better ladder it offered in an open event. */
function VaCell({ tier, offer, ev }: { tier: ReturnType<typeof vaTier>; offer?: ContractTerms; ev?: SourcingEvent }) {
  const offered = offer && ev && offer.vaPct > tier.pct
  return (
    <Tip content={offered ? `Offered in ${ev.number}: ${tierLine(offer.vaTiers ?? [[0, offer.vaPct]])}` : tierLine(tier.tiers)}>
      <span className="flex cursor-default flex-col items-end">
        <span className="font-medium tabular">{tier.pct ? `${tier.pct}%` : "None"}</span>
        <span className={cn("text-caption-1 whitespace-nowrap", offered ? "text-positive-fg" : "text-faded")}>
          {offered ? `${offer.vaPct}% offered` : tier.next ? `${tier.next.pct}% from ${moneyYear(tier.next.from)}` : "Top tier"}
        </span>
      </span>
    </Tip>
  )
}

export function Contracts() {
  const data = useData()
  const router = useRouter()
  const events = data.sourcing ?? []
  const open = events.filter((e) => e.status === "open")
  const rows = SUPPLIERS.map((s) => {
    const now = termsNow(events, s.id)
    const spend = yearlySpend(data.rateCards, s.id)
    const ev = open.find((e) => !e.approved[s.id] && latestBid(e, s.id)?.terms)
    const offer: ContractTerms | undefined = ev && latestBid(ev, s.id)!.terms
    const tier = vaTier(now, spend)
    return { s, now, spend, tier, rebate: (spend * tier.pct) / 100, ev, offer }
  }).sort((a, b) => b.spend - a.spend)
  const spend = rows.reduce((t, r) => t + r.spend, 0)
  const rebate = rows.reduce((t, r) => t + r.rebate, 0)

  return (
    <Surface elevated className="overflow-hidden" data-tour="contracts">
      <SurfaceHeader title="Agency contracts" info="Spend is a year at today's rates and each agency's share of the hours." />
      <div className="overflow-x-auto px-2 pt-3 pb-2 scrollbar-thin">
        <table className="w-full min-w-[600px] text-body-3">
          <thead>
            <tr className="text-caption-1 text-faded">
              <th className={cn(th, "text-left")}>Agency</th>
              <th className={cn(th, "text-right")}>Spend a year</th>
              <th className={cn(th, "text-right")}>
                <span className="inline-flex items-center gap-1">
                  VA
                  <InfoTip>The rebate an agency pays Compass at year end, as a share of spend. It steps up as the year&apos;s spend grows.</InfoTip>
                </span>
              </th>
              <th className={cn(th, "text-right")}>Payment</th>
              <th className={cn(th, "text-right")}>Contract</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, now, spend, tier, ev, offer }) => (
              <tr key={s.id} data-supplier={s.id} onClick={() => router.push(`/agencies/${s.id}`)} className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-hover/60">
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <SupplierLogo supplierId={s.id} size="sm" />
                    <span className="truncate font-medium">{s.name}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular">{spend ? moneyYear(spend) : "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  <VaCell tier={tier} offer={offer} ev={offer && ev} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Offered now={`Net ${now.netDays}`} value={`Net ${offer?.netDays}`} ev={offer && ev} better={!!offer && offer.netDays > now.netDays} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Offered now={years(now.years)} value={years(offer?.years ?? 0)} ev={offer && ev} />
                </td>
                <td className="pr-3">
                  <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="px-3 py-2.5">All agencies</td>
              <td className="px-3 py-2.5 text-right tabular">{moneyYear(spend)}</td>
              <td className="px-3 py-2.5 text-right tabular">{spend ? pct(rebate / spend, 1) : "—"}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Surface>
  )
}

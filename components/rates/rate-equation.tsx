"use client"

import { Equal, Plus } from "lucide-react"
import { Fragment } from "react"

import { InfoTip } from "@/components/common/info-tip"
import { cn } from "@/lib/utils"

/** The three rate terms, defined once, with the definitions in tooltips. */
export function RateEquation({ example = { pro: 20, markup: 32 } }: { example?: { pro: number; markup: number } }) {
  const bill = Math.round(example.pro * (1 + example.markup / 100) * 100) / 100
  const terms = [
    { label: "Pay rate", value: `$${example.pro.toFixed(2)}`, info: "What the Pro earns per hour, before taxes. Set by the supplier." },
    {
      label: "Supplier markup",
      value: `$${(bill - example.pro).toFixed(2)}`,
      info: `What the supplier keeps: the difference between bill rate and pay rate (${example.markup}% here). It covers payroll taxes, insurance, recruiting and margin.`,
    },
    { label: "Bill rate", value: `$${bill.toFixed(2)}`, info: "The all-in hourly rate the buyer pays. This is the number to compare across suppliers.", strong: true },
  ]
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-3 shadow-raised">
      {terms.map((t, i) => (
        <Fragment key={t.label}>
          {i > 0 && (i === 1 ? <Plus className="size-4 shrink-0 text-subtle" /> : <Equal className="size-4 shrink-0 text-subtle" />)}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1 text-caption-1 text-faded">
              {t.label} <InfoTip>{t.info}</InfoTip>
            </span>
            <span className={cn("text-body-1 font-semibold tabular", t.strong && "text-brand-strong")}>{t.value}</span>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

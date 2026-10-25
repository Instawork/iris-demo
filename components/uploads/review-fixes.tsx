"use client"

import { Check, CheckCheck } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useUploadFlow, type ReviewSession } from "@/components/uploads/use-upload-flow"
import { columnLabel, reviewItems, reviewTally, type FixAction, type FixDecision, type FixDecisions, type ReviewItem } from "@/lib/csv"
import { cn } from "@/lib/utils"

const rows = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`

/** The agent's proposed fixes for one file. Nothing is saved until every problem has a decision. */
export function ReviewFixes({ session, onChange, onDone }: { session: ReviewSession; onChange: (next: ReviewSession) => void; onDone: () => void }) {
  const flow = useUploadFlow()
  const items = useMemo(() => reviewItems(session.plan), [session.plan])
  const [decisions, setDecisions] = useState<FixDecisions>({})
  const tally = reviewTally(session.plan, items, decisions)
  const acceptable = items.filter((it) => it.issue.suggestion && !decisions[it.key] && !tally.dropped.has(it.issue.row))
  const { okCount, errorCount } = session.plan

  const decide = (item: ReviewItem, action: FixAction | "") =>
    setDecisions((prev) => {
      const next = { ...prev }
      if (!action) delete next[item.key]
      else next[item.key] = action === "edit" ? { action, value: item.issue.suggestion?.value ?? item.value } : { action }
      return next
    })

  const acceptAll = () => setDecisions((prev) => ({ ...prev, ...Object.fromEntries(acceptable.map((it) => [it.key, { action: "accept" as const }])) }))

  const save = async () => {
    const next = await flow.save(session, decisions)
    if (next) onChange(next)
    else onDone()
  }

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-border px-6 pt-5 pr-12 pb-4">
        <DialogTitle className="text-featured-3 font-bold break-all">Review fixes: {session.fileName}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-3 text-faded">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-positive" />
              <span className="font-semibold text-foreground tabular">{okCount}</span> {okCount === 1 ? "row" : "rows"} ready
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-warning" />
              <span className="font-semibold text-foreground tabular">{errorCount}</span> {errorCount === 1 ? "row needs" : "rows need"} your review
            </span>
          </div>
        </DialogDescription>
      </div>
      {session.round > 0 && (
        <p className="border-b border-border bg-warning-faded px-6 py-2 text-caption-1 font-medium text-warning-fg">
          Some fixes still have a problem. Review them to save.
        </p>
      )}
      <div className="max-h-[min(56svh,540px)] overflow-y-auto scrollbar-thin">
        <table className="w-full text-left text-body-3">
          <thead className="sticky top-0 z-10 bg-page-faded">
            <tr className="border-b border-border text-caption-1 text-faded">
              <th className="w-16 py-2 pr-2 pl-6 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Problem</th>
              <th className="px-3 py-2 font-medium">Suggested fix</th>
              <th className="py-2 pr-6 pl-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <FixRow
                key={item.key}
                session={session}
                item={item}
                decision={decisions[item.key]}
                dropped={tally.dropped.has(item.issue.row)}
                onDecide={(action) => decide(item, action)}
                onEdit={(value) => setDecisions((prev) => ({ ...prev, [item.key]: { action: "edit", value } }))}
              />
            ))}
            {!items.length && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-body-3 text-faded">
                  Nothing to fix. Every row is ready to save.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-page-faded px-6 py-3">
        <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" disabled={!acceptable.length} onClick={acceptAll}>
          <CheckCheck className="size-4" /> Accept all
        </Button>
        <div className="flex items-center gap-3">
          {tally.pending > 0 && <span className="text-caption-1 text-faded tabular">{tally.pending} left to review</span>}
          <Button className="h-9 rounded-lg px-4 text-body-3 font-semibold" disabled={tally.pending > 0 || !tally.rows} onClick={save}>
            Save {rows(tally.rows)}
          </Button>
        </div>
      </div>
    </>
  )
}

function FixRow({
  session,
  item,
  decision,
  dropped,
  onDecide,
  onEdit,
}: {
  session: ReviewSession
  item: ReviewItem
  decision?: FixDecision
  dropped: boolean
  onDecide: (action: FixAction | "") => void
  onEdit: (value: string) => void
}) {
  const { issue } = item
  const action = decision?.action ?? ""
  const leftOut = action === "reject" || (!decision && dropped)
  const field = columnLabel(session.type, issue.column)
  return (
    <tr className={cn("border-b border-border/70 align-top transition-colors duration-100 last:border-0", leftOut && "text-faded")}>
      <td className="py-3 pr-2 pl-6 font-mono text-caption-1 text-faded tabular">{issue.row}</td>
      <td className="px-3 py-3 font-medium whitespace-nowrap">{field}</td>
      <td className="px-3 py-3">
        <span className="flex min-w-36 flex-col gap-0.5">
          <span>{issue.message}</span>
          {item.value && <span className="max-w-60 truncate font-mono text-caption-1 text-subtle">{item.value}</span>}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="flex min-h-8 min-w-40 items-center">
          {action === "edit" ? (
            <Input
              autoFocus
              value={decision?.value ?? ""}
              onChange={(e) => onEdit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              aria-label={`New ${field.toLowerCase()} for row ${issue.row}`}
              className="h-8 rounded-md text-body-3"
            />
          ) : leftOut ? (
            <span>Left out</span>
          ) : issue.suggestion ? (
            <span className={cn("inline-flex items-center gap-1.5 font-medium break-all", action === "accept" && "text-positive-fg")}>
              {action === "accept" && <Check className="size-3.5 shrink-0" />}
              {issue.suggestion.label}
            </span>
          ) : (
            <span className="text-subtle">No fix found</span>
          )}
        </span>
      </td>
      <td className="py-2 pr-6 pl-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={action}
          disabled={!decision && dropped}
          onValueChange={(v) => onDecide(v as FixAction | "")}
          className="ml-auto bg-card"
          aria-label={`Fix for row ${issue.row}`}
        >
          <ToggleGroupItem value="accept" disabled={!issue.suggestion} className="text-caption-1 data-[state=on]:bg-positive-faded data-[state=on]:text-positive-fg">
            Accept
          </ToggleGroupItem>
          <ToggleGroupItem value="edit" disabled={!issue.column} className="text-caption-1 data-[state=on]:bg-tint">
            Edit
          </ToggleGroupItem>
          <ToggleGroupItem value="reject" className="text-caption-1 data-[state=on]:bg-critical-faded data-[state=on]:text-critical-fg">
            Reject
          </ToggleGroupItem>
        </ToggleGroup>
      </td>
    </tr>
  )
}

"use client"

import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowUp, CalendarPlus, Check, CheckCheck, CircleCheck, Coins, Download, FileSpreadsheet, Paperclip, Receipt, TriangleAlert, Upload, UsersRound } from "lucide-react"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import type { AgentAction, AgentMessage, ReportAnswer, ShiftDraft } from "@/components/agent/agent-store"
import type { TimesheetBatch } from "@/lib/agent-hours"
import { AGENT_FILE_ACCEPT } from "@/components/agent/use-agent"
import { LogoMark } from "@/components/brand/logo"
import { SupplierLogo } from "@/components/brand/org-avatar"
import { Tip } from "@/components/common/info-tip"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const EASE = [0.22, 1, 0.36, 1] as const

type RunAction = (action: AgentAction, messageId?: number) => void

const COMPOSE_EVENT = "iris:compose"

/** Types a sentence into the composer with this id, as if the user wrote it, and optionally sends it. */
export function compose(id: string, text: string, send = false) {
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { id, text, send } }))
}

function ActionButton({ action, onRun }: { action: AgentAction; onRun: (action: AgentAction) => void }) {
  if (action.kind === "link")
    return (
      <Button asChild variant="outline" size="sm" className="bg-background" onClick={() => onRun(action)} data-tour="agent-link">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    )
  const Icon =
    action.kind === "template"
      ? Download
      : action.kind === "create-shift"
        ? CalendarPlus
        : action.kind === "approve-timesheets" || action.kind === "submit-timesheets"
          ? CheckCheck
          : action.kind === "assign-workers"
            ? UsersRound
            : action.kind === "add-expenses"
              ? Receipt
              : action.kind === "set-tips"
              ? Coins
              : action.kind === "accept-proposal"
              ? Check
              : Upload
  const primary = action.kind === "create-shift" || action.kind === "approve-timesheets" || action.kind === "submit-timesheets" || action.kind === "assign-workers" || action.kind === "add-expenses" || action.kind === "set-tips"
  return (
    <Button
      variant={primary ? "default" : "outline"}
      size="sm"
      className={cn(!primary && "bg-background")}
      onClick={() => onRun(action)}
      data-tour={`agent-${action.kind}`}
    >
      <Icon data-icon="inline-start" />
      {action.label}
    </Button>
  )
}

/** A drafted order laid out the way a buyer checks one: what, when, what it costs, and who sees it in what order. */
function DraftCard({ draft, onPick }: { draft: ShiftDraft; onPick?: (supplierId: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-body-3 shadow-raised">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-caption-1 font-medium text-faded">Draft shift</span>
          <span className="text-body-1 font-semibold">
            {draft.headcount} {draft.position}
            {draft.headcount === 1 ? "" : "s"}
          </span>
          <span className="text-caption-1 text-faded">{draft.location}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-caption-1 font-medium text-faded">Estimated</span>
          <span className="text-body-1 font-semibold tabular">{draft.total}</span>
        </span>
      </div>
      <dl className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="text-caption-1 text-faded">When</dt>
          <dd className="font-medium">{draft.when}</dd>
          <dd className="text-caption-1 text-faded">{draft.time}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-caption-1 text-faded">Paid hours</dt>
          <dd className="font-medium">{draft.hours} per worker</dd>
          <dd className="text-caption-1 text-faded">{draft.breakMins ? `${draft.breakMins}-minute unpaid break` : "No break"}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-caption-1 text-faded">Charged to</dt>
          <dd className="font-medium">{draft.chargedTo?.name ?? draft.location}</dd>
          {draft.chargedTo && <dd className="font-mono text-caption-1 text-faded">{draft.chargedTo.costCenter}</dd>}
        </div>
      </dl>
      <div className="border-t border-border px-4 py-3">
        <span className="text-caption-1 text-faded">{onPick && draft.release.length > 1 ? "Release order · click an agency to send it there first" : "Release order"}</span>
        <ol className="mt-2 flex flex-col gap-0.5" data-tour="agent-release">
          {draft.release.map((r, index) => {
            const row = (
              <>
                <span className="w-10 text-caption-1 text-faded tabular">{r.at}</span>
                <SupplierLogo supplierId={r.supplierId} size="sm" />
                <span className="font-medium">{r.name}</span>
                {r.why && <span className="rounded-full bg-muted px-1.5 py-px text-caption-2 font-medium text-faded">{r.why}</span>}
                <span className="ml-auto tabular text-faded">${r.rate.toFixed(2)}/hr</span>
              </>
            )
            return (
              <li key={r.supplierId}>
                {onPick && index ? (
                  <button type="button" onClick={() => onPick(r.supplierId)} className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-hover">
                    {row}
                  </button>
                ) : (
                  <span className="-mx-1.5 flex items-center gap-2.5 px-1.5 py-1">{row}</span>
                )}
              </li>
            )
          })}
        </ol>
      </div>
      {draft.note && <p className="border-t border-border px-4 py-2.5 text-caption-1 text-faded">{draft.note}</p>}
    </div>
  )
}

/** A batch of timesheets at a glance: what goes in one click, then each one held back with Iris's fix beside it. */
function BatchCard({ batch, fixes, onRun }: { batch: TimesheetBatch; fixes: AgentAction[]; onRun: (action: AgentAction) => void }) {
  const fixFor = (id: string) => fixes.find((a) => a.kind === "accept-proposal" && a.id === id)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-body-3 shadow-raised">
      {batch.ready && (
        <div className={cn("flex items-start justify-between gap-4 px-4 py-3", batch.heldCount > 0 && "border-b border-border")}>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-caption-1 font-medium text-faded">
              <CircleCheck className="size-3.5 text-positive-fg" />
              {batch.ready.label}
            </span>
            <span className="text-body-1 font-semibold tabular">
              {batch.ready.count.toLocaleString("en-US")} timesheet{batch.ready.count === 1 ? "" : "s"}
            </span>
            {batch.ready.note && <span className="text-caption-1 text-faded">{batch.ready.note}</span>}
          </span>
          <span className="flex shrink-0 flex-col items-end">
            <span className="text-body-1 font-semibold tabular">{batch.ready.amount}</span>
            <span className="text-caption-1 text-faded tabular">{batch.ready.hours}</span>
          </span>
        </div>
      )}
      {batch.heldCount > 0 && (
        <div className="px-4 py-3">
          <span className="flex items-center gap-1.5 text-caption-1 font-medium text-faded">
            <TriangleAlert className="size-3.5 text-warning-fg" />
            {batch.heldLabel} · {batch.heldCount}
          </span>
          <ul className="mt-1 flex flex-col divide-y divide-border">
            {batch.held.map((row) => {
              const fix = fixFor(row.id)
              return (
                <li key={row.id} className="flex items-center gap-3 py-2.5" data-tour="agent-flag" data-ts={row.id}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate font-semibold">{row.name}</span>
                      {row.meta && <span className="shrink-0 text-caption-1 text-faded">{row.meta}</span>}
                    </span>
                    <Tip content={row.detail}>
                      <span className="w-fit text-caption-1 font-medium text-warning-fg">{row.issue}</span>
                    </Tip>
                  </span>
                  {fix && fix.kind === "accept-proposal" && (
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <Button variant="outline" size="sm" className="bg-background" onClick={() => onRun(fix)} data-tour="agent-accept-proposal">
                        <Check data-icon="inline-start" />
                        {fix.hours.toFixed(2)} hrs
                      </Button>
                      {row.saves && <span className="text-caption-2 text-faded tabular">{row.saves}</span>}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {batch.more && <p className="text-caption-1 text-faded">{batch.more}</p>}
        </div>
      )}
    </div>
  )
}

/** Iris's mark while a reply is coming: the pupil glances around the iris, settling at each look. */
function ThinkingMark({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  const mask = `iris-pupil-${useId().replace(/[^\w-]/g, "")}`
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="dark:hidden" fill="var(--logo-tile)" />
      <mask id={mask}>
        <rect width="32" height="32" fill="white" />
        <motion.circle
          r="4.9"
          fill="black"
          initial={{ cx: 17.6, cy: 14.4 }}
          animate={reduce ? undefined : { cx: [17.6, 17.6, 14.2, 14.2, 14.6, 14.6, 17.8, 17.8, 17.6], cy: [14.4, 14.4, 14.6, 14.6, 17.8, 17.8, 17.4, 17.4, 14.4] }}
          transition={{ duration: 2.4, ease: [0.34, 1.56, 0.64, 1], repeat: Infinity }}
        />
      </mask>
      <motion.circle
        cx="16"
        cy="16"
        r="9.4"
        fill="var(--brand)"
        mask={`url(#${mask})`}
        animate={reduce ? { opacity: [1, 0.55, 1] } : undefined}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  )
}

/** A report answer the way you'd glance at one: the number, how it moved, and who it came from. */
function ReportCard({ report }: { report: ReportAnswer }) {
  const reduce = useReducedMotion()
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-body-3 shadow-raised">
      <div className={cn("flex items-end justify-between gap-4 px-4 py-3", report.rows.length > 0 && "border-b border-border")}>
        <span className="flex min-w-0 flex-col">
          <span className="text-caption-1 font-medium text-faded">
            {report.title} · {report.when}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-featured-2 font-semibold tabular">{report.total}</span>
            {report.change && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-caption-1 font-medium tabular",
                  report.change.good === true ? "bg-positive-faded text-positive-fg" : report.change.good === false ? "bg-critical-faded text-critical-fg" : "bg-muted text-faded",
                )}
              >
                {report.change.label}
              </span>
            )}
          </span>
          {(report.change || report.only) && (
            <span className="text-caption-1 text-faded">{[report.change?.against, report.only && `Only ${report.only}`].filter(Boolean).join(" · ")}</span>
          )}
        </span>
        {report.extras.length > 0 && (
          <dl className="flex shrink-0 gap-4 text-right">
            {report.extras.map((x) => (
              <div key={x.label} className="flex flex-col">
                <dt className="text-caption-1 text-faded">{x.label}</dt>
                <dd className="font-semibold tabular">{x.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {report.rows.length === 0 ? null : report.trend ? (
        <ol className="flex h-36 items-end gap-1.5 px-4 pt-4 pb-3">
          {report.rows.map((row, index) => (
            <li key={row.key} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-caption-2 text-faded tabular">{row.value}</span>
              <span className="flex min-h-0 w-full flex-1 items-end justify-center">
                <motion.span
                  className="block w-full max-w-10 origin-bottom rounded-t-[4px]"
                  style={{ background: row.color, height: `${Math.max(4, row.share * 100)}%`, opacity: row.partial ? 0.35 : 1 }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.5, delay: 0.1 + index * 0.04, ease: EASE }}
                />
              </span>
              <span className="max-w-full truncate text-caption-2 text-faded">{row.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="flex flex-col gap-2.5 px-4 py-3">
          {report.rows.map((row, index) => (
            <li key={row.key} className="flex flex-col gap-1">
              <span className="flex items-center gap-2">
                {row.supplierId && <SupplierLogo supplierId={row.supplierId} size="sm" />}
                <span className="min-w-0 truncate font-medium">{row.label}</span>
                <span className="ml-auto tabular">{row.value}</span>
                {row.pct && <span className="w-9 text-right text-caption-1 text-faded tabular">{row.pct}</span>}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.span
                  className="block h-full origin-left rounded-full"
                  style={{ background: row.color, width: `${Math.max(2, row.share * 100)}%` }}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.1 + index * 0.06, ease: EASE }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
      {report.more ? <p className="border-t border-border px-4 py-2.5 text-caption-1 text-faded">And {report.more} more in the full report</p> : null}
    </div>
  )
}

/** The conversation itself. Agent replies read as prose next to Iris's mark; the user's turns sit in bubbles. */
export function AgentMessages({
  messages,
  onRun,
  onPickFirst,
  thinking,
  compact,
}: {
  messages: AgentMessage[]
  onRun: RunAction
  /** Iris is working on a reply. */
  thinking?: boolean
  /** Redrafts an unsent order with another agency first. */
  onPickFirst?: (messageId: number, supplierId: string) => void
  compact?: boolean
}) {
  const reduce = useReducedMotion()
  return (
    <ol className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <motion.li
            key={message.id}
            initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: EASE }}
            className={cn("flex gap-3", message.from === "user" ? "justify-end" : "justify-start")}
            data-tour={
              message.actions?.some((a) => a.kind === "create-shift")
                ? "agent-draft"
                : message.actions?.some((a) => a.kind === "submit-timesheets" || a.kind === "assign-workers" || a.kind === "add-expenses" || a.kind === "set-tips" || a.kind === "approve-timesheets" || a.kind === "accept-proposal")
                  ? "agent-plan"
                  : undefined
            }
          >
            {message.from === "agent" && <LogoMark className="mt-0.5 size-6" />}
            <div
              className={cn(
                "flex min-w-0 flex-col gap-2.5",
                message.from === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-body-3 text-background"
                  : cn("flex-1 text-foreground", compact ? "text-body-3" : "text-body-2"),
              )}
            >
              {message.fileName && (
                <span className="flex items-center gap-2 border-b border-current/15 pb-2 font-medium">
                  <FileSpreadsheet className="size-4" />
                  {message.fileName}
                </span>
              )}
              {message.text && <p className="whitespace-pre-wrap text-pretty">{message.text}</p>}
              {message.report && <ReportCard report={message.report} />}
              {message.draft && (
                <DraftCard
                  draft={message.draft}
                  onPick={onPickFirst && message.actions?.some((a) => a.kind === "create-shift") ? (supplierId) => onPickFirst(message.id, supplierId) : undefined}
                />
              )}
              {message.batch && <BatchCard batch={message.batch} fixes={message.actions ?? []} onRun={(item) => onRun(item, message.id)} />}
              {message.actions?.some((a) => !(message.batch && a.kind === "accept-proposal")) && (
                <div className="flex flex-wrap gap-2">
                  {message.actions.filter((a) => !(message.batch && a.kind === "accept-proposal")).map((action) => (
                    <ActionButton key={action.label} action={action} onRun={(item) => onRun(item, message.id)} />
                  ))}
                </div>
              )}
            </div>
          </motion.li>
        ))}
        {thinking && (
          <motion.li
            key="thinking"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.24, ease: EASE }}
            className="flex items-center gap-3"
            role="status"
          >
            <ThinkingMark className="size-6" />
            <span className={cn("text-shimmer font-medium", compact ? "text-body-3" : "text-body-2")}>Thinking</span>
          </motion.li>
        )}
      </AnimatePresence>
    </ol>
  )
}

/** The ask bar: a sentence or a spreadsheet. Enter sends, Shift+Enter adds a line. */
export function AgentComposer({
  id,
  size = "default",
  label,
  placeholder,
  onSubmit,
  onAttach,
  className,
  children,
}: {
  id?: string
  size?: "default" | "lg"
  label: string
  placeholder: ReactNode
  onSubmit: (text: string) => void
  onAttach: (file?: File) => void
  className?: string
  /** Sits before the send button, e.g. a shortcut hint. */
  children?: ReactNode
}) {
  const [draft, setDraft] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef(onSubmit)
  const send = () => {
    if (!draft.trim()) return
    onSubmit(draft)
    setDraft("")
  }
  const lg = size === "lg"

  useEffect(() => {
    submitRef.current = onSubmit
  }, [onSubmit])

  useEffect(() => {
    if (!id) return
    let timer: number | undefined
    const onCompose = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; text: string; send: boolean }>).detail
      if (detail?.id !== id) return
      window.clearInterval(timer)
      let typed = 0
      timer = window.setInterval(() => {
        typed = Math.min(detail.text.length, typed + 2)
        setDraft(detail.text.slice(0, typed))
        if (typed < detail.text.length) return
        window.clearInterval(timer)
        document.getElementById(id)?.focus()
        if (detail.send) {
          submitRef.current(detail.text)
          setDraft("")
        }
      }, 16)
    }
    window.addEventListener(COMPOSE_EVENT, onCompose)
    return () => {
      window.removeEventListener(COMPOSE_EVENT, onCompose)
      window.clearInterval(timer)
    }
  }, [id])
  return (
    <InputGroup
      className={cn(
        "relative h-auto items-stretch rounded-2xl bg-card shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_6%,transparent),0_12px_32px_-16px_color-mix(in_oklch,var(--foreground)_22%,transparent)] transition-[box-shadow,border-color] duration-200 has-disabled:bg-card has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:border-foreground/20 has-[[data-slot=input-group-control]:focus-visible]:ring-4 has-[[data-slot=input-group-control]:focus-visible]:ring-brand/25 dark:bg-card dark:has-disabled:bg-card",
        className,
      )}
    >
      {lg && (
        <InputGroupAddon align="inline-start" className="self-start pt-3.5 pl-3.5">
          <LogoMark className="size-6" />
        </InputGroupAddon>
      )}
      <div className="relative min-w-0 flex-1 self-stretch">
        <InputGroupTextarea
          id={id}
          aria-label={label}
          value={draft}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          className={cn("max-h-40 pr-1 text-sm", lg ? "min-h-14 py-[17px] pl-2.5 text-[15px] md:text-[15px]" : "min-h-12 py-3.5 pl-4 md:text-sm")}
        />
        {!draft && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 flex items-center overflow-hidden text-sm whitespace-nowrap text-muted-foreground",
              lg ? "h-14 pl-2.5 text-[15px]" : "h-12 pl-4",
            )}
          >
            {placeholder}
          </span>
        )}
      </div>
      <InputGroupAddon align="inline-end" className={cn("flex-row items-center gap-1 self-end", lg ? "pr-2.5 pb-2.5" : "pr-2 pb-2")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton size="icon-sm" className={cn("rounded-full text-muted-foreground hover:text-foreground", lg && "size-9")} onClick={() => fileRef.current?.click()} aria-label="Attach CSV or Excel file">
              <Paperclip />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>Attach a CSV or Excel file. Nothing saves until you approve it.</TooltipContent>
        </Tooltip>
        {children}
        <InputGroupButton
          variant="default"
          size="icon-sm"
          className={cn("rounded-full transition-transform active:scale-95", lg && "size-9")}
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Send"
        >
          <ArrowUp />
        </InputGroupButton>
      </InputGroupAddon>
      <input
        ref={fileRef}
        type="file"
        data-agent-file
        accept={AGENT_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          onAttach(file)
        }}
      />
    </InputGroup>
  )
}

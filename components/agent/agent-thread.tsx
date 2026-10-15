"use client"

import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowUp, CalendarPlus, Download, FileSpreadsheet, Paperclip, Upload } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"

import type { AgentAction, AgentMessage } from "@/components/agent/agent-store"
import { AGENT_FILE_ACCEPT } from "@/components/agent/use-agent"
import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const EASE = [0.22, 1, 0.36, 1] as const

type RunAction = (action: AgentAction, messageId?: number) => void

function ActionButton({ action, onRun }: { action: AgentAction; onRun: (action: AgentAction) => void }) {
  if (action.kind === "link")
    return (
      <Button asChild variant="outline" size="sm" className="bg-background" onClick={() => onRun(action)}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    )
  const Icon = action.kind === "template" ? Download : action.kind === "create-shift" ? CalendarPlus : Upload
  return (
    <Button variant={action.kind === "create-shift" ? "default" : "outline"} size="sm" className={cn(action.kind !== "create-shift" && "bg-background")} onClick={() => onRun(action)}>
      <Icon data-icon="inline-start" />
      {action.label}
    </Button>
  )
}

/** The conversation itself. Agent replies read as prose next to CrUber's mark; the user's turns sit in bubbles. */
export function AgentMessages({ messages, onRun, compact }: { messages: AgentMessage[]; onRun: RunAction; compact?: boolean }) {
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
              <p className="whitespace-pre-wrap text-pretty">{message.text}</p>
              {message.actions && (
                <div className="flex flex-wrap gap-2">
                  {message.actions.map((action) => (
                    <ActionButton key={action.label} action={action} onRun={(item) => onRun(item, message.id)} />
                  ))}
                </div>
              )}
            </div>
          </motion.li>
        ))}
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
  const send = () => {
    if (!draft.trim()) return
    onSubmit(draft)
    setDraft("")
  }
  const lg = size === "lg"
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

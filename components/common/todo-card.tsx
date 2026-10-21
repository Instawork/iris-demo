"use client"

import Link from "next/link"
import {
  AlertTriangle,
  BadgeDollarSign,
  ChevronRight,
  Clock,
  Coins,
  FileText,
  MessageSquareWarning,
  ShieldCheck,
  Upload,
  UserRoundCheck,
} from "lucide-react"

import { InfoTip } from "@/components/common/info-tip"
import type { Todo } from "@/lib/metrics"
import { cn } from "@/lib/utils"

const ICONS = {
  clock: Clock,
  invoice: FileText,
  alert: AlertTriangle,
  user: UserRoundCheck,
  shield: ShieldCheck,
  rate: BadgeDollarSign,
  dispute: MessageSquareWarning,
  upload: Upload,
  tip: Coins,
}

const ICON_TONE: Record<Todo["tone"], string> = {
  primary: "text-foreground",
  warning: "text-warning-fg",
  critical: "text-critical-fg",
  positive: "text-positive-fg",
  neutral: "text-faded",
}

/** One to-do in the "Needs your attention" list; the whole row opens the work. */
export function TodoRow({ todo }: { todo: Todo }) {
  const Icon = ICONS[todo.icon]
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3 transition-colors duration-100 hover:bg-hover has-[a:focus-visible]:bg-hover" data-tour={`todo-${todo.id}`}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-tint-faded ring-1 ring-border ring-inset", ICON_TONE[todo.tone])}>
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Link href={todo.href} className="truncate text-body-3 font-medium text-foreground outline-none after:absolute after:inset-0">
          {todo.title}
        </Link>
        <InfoTip className="relative z-10">{todo.description}</InfoTip>
      </div>
      <span className="hidden shrink-0 text-body-3 text-faded transition-colors group-hover:text-foreground sm:inline">{todo.cta}</span>
      <ChevronRight className="size-4 shrink-0 text-subtle transition-[color,transform] duration-100 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </li>
  )
}

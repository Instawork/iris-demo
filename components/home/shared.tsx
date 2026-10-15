"use client"

import Link from "next/link"
import { ArrowRight, CheckCircle2 } from "lucide-react"

import { SectionTitle } from "@/components/common/page-header"
import { TodoRow } from "@/components/common/todo-card"
import { useWorkspace } from "@/hooks/use-app"
import { formatDay, timeAgo, todayISO } from "@/lib/dates"
import type { Todo } from "@/lib/metrics"
import type { ActivityEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

const greetingWord = () => {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

export function Greeting({ subtitle, actions }: { subtitle: React.ReactNode; actions?: React.ReactNode }) {
  const { ws } = useWorkspace()
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-caption-1 text-faded">
          <span>{formatDay(todayISO(), "EEEE, MMMM d")}</span>
          <span className="inline-flex h-[18px] items-center gap-1 rounded-[5px] bg-brand px-1.5 text-caption-2 font-semibold text-brand-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-brand-foreground" />
            Live
          </span>
        </div>
        <h1 className="text-featured-1 font-semibold">
          {greetingWord()}, {ws.user.firstName}
        </h1>
        <p className="text-body-3 text-faded">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function TodoSection({ todos, title = "Needs your attention" }: { todos: Todo[]; title?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        title={
          <>
            {title}
            {todos.length > 0 && <span className="rounded-[5px] bg-foreground/[0.06] px-1.5 text-caption-1 leading-5 font-medium text-faded tabular">{todos.length}</span>}
          </>
        }
      />
      {todos.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {todos.map((t) => (
            <TodoRow key={t.id} todo={t} />
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 text-body-3 text-faded">
          <CheckCircle2 className="size-4 text-positive" />
          You&apos;re all caught up.
        </div>
      )}
    </section>
  )
}

const TONE_DOT: Record<ActivityEvent["tone"], string> = {
  neutral: "bg-border-strong",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  primary: "bg-foreground",
}

export function ActivityFeed({ events, limit = 7 }: { events: ActivityEvent[]; limit?: number }) {
  const list = events.slice(0, limit)
  if (!list.length) return <p className="px-5 pb-5 text-body-3 text-faded">No activity yet.</p>
  return (
    <ol className="relative flex flex-col px-5 pb-4 before:absolute before:top-3 before:bottom-7 before:left-[23px] before:w-px before:bg-border">
      {list.map((e) => (
        <li key={e.id} className="relative flex gap-3 py-2">
          <span className={cn("relative z-10 mt-[7px] size-[7px] shrink-0 rounded-full ring-[3px] ring-card", TONE_DOT[e.tone])} />
          <div className="flex min-w-0 flex-col">
            <span className="text-body-3 text-foreground">{e.text}</span>
            <span className="text-caption-1 text-subtle">{timeAgo(e.at)}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-body-3 text-faded transition-colors hover:text-foreground">
      {label} <ArrowRight className="size-3.5 transition-transform duration-100 group-hover:translate-x-0.5" />
    </Link>
  )
}

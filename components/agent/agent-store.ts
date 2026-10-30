"use client"

import { create } from "zustand"

import type { AgencyAction } from "@/lib/agent-agency"
import type { HoursAction, TimesheetBatch } from "@/lib/agent-hours"
import type { BookingInput } from "@/lib/store"
import type { UploadType } from "@/lib/types"

export type AgentAction =
  | { label: string; kind: "link"; href: string }
  | { label: string; kind: "template"; type: UploadType }
  | { label: string; kind: "upload"; type?: UploadType }
  | { label: string; kind: "review"; type: UploadType; fileName: string; csv: string }
  /** `key` is made with the draft, so a double click or a retry posts once, and no two drafts share one. */
  | { label: string; kind: "create-shift"; input: BookingInput; key: string }
  | HoursAction
  | AgencyAction

/** A shift order Iris drafted from a sentence, shown as a card above its actions. */
export interface ShiftDraft {
  headcount: number
  position: string
  location: string
  when: string
  time: string
  hours: number
  breakMins: number
  /** In release order. `why` says why the first one is first. */
  release: { supplierId: string; name: string; rate: number; at: string; why?: string }[]
  total: string
  /** The department, or the unit when it has none, and the cost center the hours are charged to. */
  chargedTo?: { name: string; costCenter: string }
  note?: string
}

/** A report answer laid out as a card: the headline number, how it moved, and the biggest groups. */
export interface ReportAnswer {
  title: string
  when: string
  only?: string
  total: string
  /** Against the same number of days before. `good` is unset when the direction doesn't matter. */
  change?: { label: string; good?: boolean; against: string }
  extras: { label: string; value: string }[]
  /** Ranked, or in time order for a trend. `share` is the bar length, 0 to 1. */
  rows: { key: string; label: string; value: string; share: number; color: string; pct?: string; supplierId?: string; partial?: boolean }[]
  /** Rows are periods, drawn as columns. */
  trend?: boolean
  more?: number
}

export interface AgentMessage {
  id: number
  from: "agent" | "user"
  text: string
  draft?: ShiftDraft
  report?: ReportAnswer
  batch?: TimesheetBatch
  actions?: AgentAction[]
  fileName?: string
}

export const NO_MESSAGES: AgentMessage[] = []

interface AgentState {
  nextId: number
  threads: Record<string, AgentMessage[]>
  /** Workspaces whose reply Iris is still working on. */
  thinking: Record<string, boolean>
  push: (workspaceId: string, message: Omit<AgentMessage, "id">) => void
  /** Posts Iris's reply after a short think, in order behind any reply still coming. */
  reply: (workspaceId: string, message: Omit<AgentMessage, "id">) => Promise<void>
  clear: (workspaceId: string) => void
  dropActions: (workspaceId: string, messageId: number) => void
  update: (workspaceId: string, messageId: number, patch: Partial<Omit<AgentMessage, "id">>) => void
}

/** How long Iris seems to think: longer for a fuller answer, never long enough to wait on. */
const thinkFor = (message: Omit<AgentMessage, "id">) => Math.min(1500, 650 + message.text.length * 2 + (message.draft || message.report ? 350 : 0))

const queues = new Map<string, Promise<void>>()
/** Bumped by clear, so a reply still thinking doesn't land in a thread that was cleared. */
const epochs = new Map<string, number>()

/** One conversation per workspace, shared by Home and the Agent Chat sheet so a thread follows you between them. */
export const useAgentThreads = create<AgentState>()((set, get) => ({
  nextId: 1,
  threads: {},
  thinking: {},
  push: (workspaceId, message) =>
    set((state) => ({
      nextId: state.nextId + 1,
      threads: { ...state.threads, [workspaceId]: [...(state.threads[workspaceId] ?? []), { ...message, id: state.nextId }] },
    })),
  reply: (workspaceId, message) => {
    const epoch = epochs.get(workspaceId) ?? 0
    const next = (queues.get(workspaceId) ?? Promise.resolve()).then(async () => {
      if ((epochs.get(workspaceId) ?? 0) !== epoch) return
      set((state) => ({ thinking: { ...state.thinking, [workspaceId]: true } }))
      await new Promise((resolve) => window.setTimeout(resolve, thinkFor(message)))
      if ((epochs.get(workspaceId) ?? 0) === epoch) get().push(workspaceId, message)
      set((state) => ({ thinking: { ...state.thinking, [workspaceId]: false } }))
    })
    queues.set(workspaceId, next)
    return next
  },
  clear: (workspaceId) => {
    epochs.set(workspaceId, (epochs.get(workspaceId) ?? 0) + 1)
    set((state) => ({ threads: { ...state.threads, [workspaceId]: [] }, thinking: { ...state.thinking, [workspaceId]: false } }))
  },
  dropActions: (workspaceId, messageId) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [workspaceId]: (state.threads[workspaceId] ?? []).map((m) => (m.id === messageId ? { ...m, actions: undefined } : m)),
      },
    })),
  update: (workspaceId, messageId, patch) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [workspaceId]: (state.threads[workspaceId] ?? []).map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      },
    })),
}))

"use client"

import { create } from "zustand"

import type { HoursAction } from "@/lib/agent-hours"
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
  budget?: { text: string; over: boolean }
  note?: string
}

export interface AgentMessage {
  id: number
  from: "agent" | "user"
  text: string
  draft?: ShiftDraft
  actions?: AgentAction[]
  fileName?: string
}

export const NO_MESSAGES: AgentMessage[] = []

interface AgentState {
  nextId: number
  threads: Record<string, AgentMessage[]>
  push: (workspaceId: string, message: Omit<AgentMessage, "id">) => void
  clear: (workspaceId: string) => void
  dropActions: (workspaceId: string, messageId: number) => void
  update: (workspaceId: string, messageId: number, patch: Partial<Omit<AgentMessage, "id">>) => void
}

/** One conversation per workspace, shared by Home and the Agent Chat sheet so a thread follows you between them. */
export const useAgentThreads = create<AgentState>()((set) => ({
  nextId: 1,
  threads: {},
  push: (workspaceId, message) =>
    set((state) => ({
      nextId: state.nextId + 1,
      threads: { ...state.threads, [workspaceId]: [...(state.threads[workspaceId] ?? []), { ...message, id: state.nextId }] },
    })),
  clear: (workspaceId) => set((state) => ({ threads: { ...state.threads, [workspaceId]: [] } })),
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

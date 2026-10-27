"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type { RequirementId } from "@/lib/types"

/** The counters and time when the tour began. Anything numbered at or above them, or done after it, is the player's own work. */
export interface TourBase {
  sg: number
  inv: number
  rep: number
  at: string
}

/** What the player picked, so later steps follow their choice. */
export interface TourPicks {
  proId?: string
  invoiceId?: string
  groupId?: string
  docId?: RequirementId
  sheetId?: string
}

/** Where the guided tour stands. Kept for the tab's session, so a reload picks up the same step. */
interface TourState extends TourPicks {
  active: boolean
  index: number
  enteredAt: string
  base: TourBase
  done: string[]
  skipped: string[]
  open: () => void
  begin: (base: TourBase) => void
  rebase: (base: TourBase) => void
  go: (index: number) => void
  finish: (id: string, how: "done" | "skipped") => void
  remember: (patch: TourPicks) => void
  exit: () => void
}

const now = () => new Date().toISOString()

export const useTour = create<TourState>()(
  persist(
    (set) => ({
      active: false,
      index: 0,
      enteredAt: "",
      base: { sg: 0, inv: 0, rep: 0, at: "" },
      done: [],
      skipped: [],
      open: () => set({ active: true, index: 0, enteredAt: now(), done: [], skipped: [], proId: undefined, invoiceId: undefined, groupId: undefined, docId: undefined, sheetId: undefined }),
      begin: (base) => set((s) => ({ base, index: s.index + 1, enteredAt: now() })),
      rebase: (base) => set({ base }),
      go: (index) => set({ index, enteredAt: now() }),
      finish: (id, how) =>
        set((s) => ({
          index: s.index + 1,
          enteredAt: now(),
          done: how === "done" ? [...s.done.filter((x) => x !== id), id] : s.done,
          skipped: how === "skipped" ? [...s.skipped.filter((x) => x !== id), id] : s.skipped,
        })),
      remember: (patch) => set(patch),
      exit: () => set({ active: false }),
    }),
    {
      name: "iris-tour-v2",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: ({ active, index, enteredAt, base, done, skipped, proId, invoiceId, groupId, docId, sheetId }) => ({ active, index, enteredAt, base, done, skipped, proId, invoiceId, groupId, docId, sheetId }),
    },
  ),
)

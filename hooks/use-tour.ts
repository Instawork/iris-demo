"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

/** The shift and invoice counters when the tour began. Anything numbered at or above them is the player's own work. */
export interface TourBase {
  sg: number
  inv: number
}

/** Where the guided tour stands. Kept for the tab's session, so a reload picks up the same step. */
interface TourState {
  active: boolean
  index: number
  enteredAt: string
  base: TourBase
  done: string[]
  skipped: string[]
  /** The Pro and invoice the player picked, so later steps follow their choice. */
  proId?: string
  invoiceId?: string
  open: () => void
  begin: (base: TourBase) => void
  go: (index: number) => void
  finish: (id: string, how: "done" | "skipped") => void
  remember: (patch: { proId?: string; invoiceId?: string }) => void
  exit: () => void
}

const now = () => new Date().toISOString()

export const useTour = create<TourState>()(
  persist(
    (set) => ({
      active: false,
      index: 0,
      enteredAt: "",
      base: { sg: 0, inv: 0 },
      done: [],
      skipped: [],
      open: () => set({ active: true, index: 0, enteredAt: now(), done: [], skipped: [], proId: undefined, invoiceId: undefined }),
      begin: (base) => set((s) => ({ base, index: s.index + 1, enteredAt: now() })),
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
      name: "iris-tour",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: ({ active, index, enteredAt, base, done, skipped, proId, invoiceId }) => ({ active, index, enteredAt, base, done, skipped, proId, invoiceId }),
    },
  ),
)

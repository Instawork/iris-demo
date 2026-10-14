"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { PersonaKind, UploadType } from "@/lib/types"

interface UiState {
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  paletteOpen: boolean
  helpOpen: boolean
  helpTopic?: string
  helpSession: number
  uploadOpen: boolean
  uploadType?: UploadType
  welcomeSeen: Partial<Record<PersonaKind, boolean>>
  shiftsView: "list" | "calendar"
  toggleSidebar: () => void
  setMobileNav: (open: boolean) => void
  setPalette: (open: boolean) => void
  togglePalette: () => void
  openHelp: (topic?: string) => void
  closeHelp: () => void
  openUpload: (type?: UploadType) => void
  closeUpload: () => void
  markWelcome: (kind: PersonaKind) => void
  resetWelcome: () => void
  setShiftsView: (view: "list" | "calendar") => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      paletteOpen: false,
      helpOpen: false,
      helpSession: 0,
      uploadOpen: false,
      welcomeSeen: {},
      shiftsView: "list",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (open) => set({ mobileNavOpen: open }),
      setPalette: (open) => set({ paletteOpen: open }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
      openHelp: (topic) => set((s) => ({ helpOpen: true, helpTopic: topic, helpSession: s.helpSession + 1 })),
      closeHelp: () => set({ helpOpen: false }),
      openUpload: (type) => set({ uploadOpen: true, uploadType: type }),
      closeUpload: () => set({ uploadOpen: false }),
      markWelcome: (kind) => set((s) => ({ welcomeSeen: { ...s.welcomeSeen, [kind]: true } })),
      resetWelcome: () => set({ welcomeSeen: {} }),
      setShiftsView: (view) => set({ shiftsView: view }),
    }),
    {
      name: "cruber-ui",
      skipHydration: true,
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, welcomeSeen: s.welcomeSeen, shiftsView: s.shiftsView }),
    },
  ),
)

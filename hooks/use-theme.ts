"use client"

import { useEffect } from "react"
import { create } from "zustand"

import { THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from "@/lib/theme"

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches

const resolve = (theme: ThemePreference): ResolvedTheme => (theme === "system" ? (prefersDark() ? "dark" : "light") : theme)

/** Swaps the theme in one frame; without this, elements with color transitions fade while others snap. */
const apply = (resolved: ResolvedTheme) => {
  const freeze = document.createElement("style")
  freeze.textContent = "*,*::before,*::after{transition:none!important}"
  document.head.appendChild(freeze)
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
  void window.getComputedStyle(document.body).opacity
  requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()))
}

const stored = (): ThemePreference => {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === "dark" || value === "system" ? value : "light"
  } catch {
    return "light"
  }
}

interface ThemeState {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
}

const useThemeStore = create<ThemeState>()((set) => ({
  theme: "light",
  resolvedTheme: "light",
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {}
    const resolvedTheme = resolve(theme)
    apply(resolvedTheme)
    set({ theme, resolvedTheme })
  },
}))

export const useTheme = () => useThemeStore()

/** Reads the saved preference once mounted and keeps "system" in step with the OS. */
export function ThemeSync() {
  useEffect(() => {
    const theme = stored()
    useThemeStore.setState({ theme, resolvedTheme: resolve(theme) })
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (useThemeStore.getState().theme === "system") useThemeStore.getState().setTheme("system")
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  return null
}

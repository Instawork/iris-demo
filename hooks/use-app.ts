"use client"

import { useMemo } from "react"

import { scopeOf } from "@/lib/metrics"
import { workspace } from "@/lib/reference"
import { useStore } from "@/lib/store"

export const useData = () => useStore((s) => s.data)

export function useWorkspace() {
  const id = useStore((s) => s.workspaceId)
  return useMemo(() => {
    const ws = workspace(id)
    return { ws, scope: scopeOf(ws) }
  }, [id])
}

export const actions = () => useStore.getState()

"use client"

import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { navFor } from "@/components/shell/nav-config"
import { useWorkspace } from "@/hooks/use-app"
import { useStore } from "@/lib/store"
import type { Workspace } from "@/lib/types"

const sectionOf = (pathname: string) => pathname.split("/")[1] ?? ""

/** Switches persona and keeps you on the same section when the new workspace has it. */
export function useSwitchWorkspace() {
  const { ws } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const setWorkspace = useStore((s) => s.setWorkspace)

  return (next: Workspace) => {
    if (next.id === ws.id) return
    setWorkspace(next.id)
    const section = sectionOf(pathname)
    const nav = navFor(next).map((n) => n.href.split("/")[1])
    const keep = section && nav.includes(section) && pathname.split("/").length <= 2 ? `/${section}` : section === "settings" ? pathname : "/"
    router.push(keep)
    toast(`Now viewing as ${next.user.name}`, { description: `${next.name} · ${next.user.title}` })
  }
}

"use client"

import { useEffect, useRef, useState } from "react"

import { LogoMark } from "@/components/brand/logo"
import { SupplierLogo, WorkspaceAvatar } from "@/components/brand/org-avatar"
import { WORKSPACES, supplier } from "@/lib/reference"
import { cn } from "@/lib/utils"

function Node({
  nodeRef,
  children,
  label,
  sub,
  side,
}: {
  nodeRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  label: string
  sub?: string
  side: "left" | "right"
}) {
  return (
    <div className={cn("flex items-center gap-2.5", side === "left" && "flex-row-reverse text-right")}>
      <div ref={nodeRef} className="relative z-10 rounded-[10px] bg-card p-0.5 ring-1 ring-border">
        {children}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-caption-1 font-medium text-foreground">{label}</span>
        {sub && <span className="truncate text-caption-2 text-subtle">{sub}</span>}
      </div>
    </div>
  )
}

/** Buyers and Compass on the left, every supplier on the right, CrUber in the middle. */
export function HubDiagram({ className }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const hub = useRef<HTMLDivElement>(null)
  const levy = useRef<HTMLDivElement>(null)
  const chartwells = useRef<HTMLDivElement>(null)
  const compass = useRef<HTMLDivElement>(null)
  const instawork = useRef<HTMLDivElement>(null)
  const crewline = useRef<HTMLDivElement>(null)
  const harbor = useRef<HTMLDivElement>(null)
  const metro = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<string[]>([])
  const [wsLevy, wsChartwells, wsCompass] = WORKSPACES

  useEffect(() => {
    const el = container.current
    if (!el) return
    const links = [levy, chartwells, compass, instawork, crewline, harbor, metro]
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect()
      const center = hub.current?.getBoundingClientRect()
      if (!center) return
      const hx = center.left - box.left + center.width / 2
      const hy = center.top - box.top + center.height / 2
      setPaths(
        links.map((ref) => {
          const r = ref.current?.getBoundingClientRect()
          if (!r) return ""
          const x = r.left - box.left + r.width / 2
          const y = r.top - box.top + r.height / 2
          return `M ${x},${y} C ${(x + hx) / 2},${y} ${(x + hx) / 2},${hy} ${hx},${hy}`
        }),
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={container} className={cn("relative grid grid-cols-[1fr_auto_1fr] items-center gap-8 px-2 py-4", className)}>
      <svg className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden>
        {paths.map((d, i) => d && <path key={i} d={d} stroke="var(--border-strong)" strokeWidth={1.25} />)}
      </svg>
      <div className="flex flex-col items-end gap-5">
        <Node nodeRef={levy} label={wsLevy.name} sub="Buyer" side="left">
          <WorkspaceAvatar ws={wsLevy} size="md" />
        </Node>
        <Node nodeRef={chartwells} label={wsChartwells.name} sub="Buyer" side="left">
          <WorkspaceAvatar ws={wsChartwells} size="md" />
        </Node>
        <Node nodeRef={compass} label={wsCompass.name} sub="Program office" side="left">
          <WorkspaceAvatar ws={wsCompass} size="md" />
        </Node>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div ref={hub} className="relative z-10 rounded-[12px] bg-card p-1 shadow-raised ring-1 ring-border">
          <LogoMark className="size-10" />
        </div>
        <span className="text-caption-1 font-semibold">CrUber</span>
      </div>
      <div className="flex flex-col items-start gap-4">
        {(
          [
            ["instawork", instawork],
            ["crewline", crewline],
            ["harbor", harbor],
            ["metro", metro],
          ] as const
        ).map(([id, ref]) => {
          const s = supplier(id)
          return (
            <Node key={id} nodeRef={ref} label={s.shortName} sub={s.integration === "api" ? "API · real time" : "CSV uploads"} side="right">
              <SupplierLogo supplierId={id} size="md" />
            </Node>
          )
        })}
      </div>
    </div>
  )
}

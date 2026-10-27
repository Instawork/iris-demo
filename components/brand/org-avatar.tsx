import { findSupplier } from "@/lib/reference"
import type { Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

const SIZE = {
  xs: "size-5 rounded-[5px] text-[9px]",
  sm: "size-6 rounded-[6px] text-[10px]",
  md: "size-8 rounded-[8px] text-[11.5px]",
  lg: "size-9 rounded-[9px] text-[13px]",
  xl: "size-12 rounded-[12px] text-[16px]",
}

function Monogram({ size, className, children }: { size: keyof typeof SIZE; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-tint-faded font-semibold tracking-[-0.02em] text-foreground ring-1 ring-border ring-inset",
        SIZE[size],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function SupplierLogo({
  supplierId,
  size = "md",
  className,
}: {
  supplierId: string
  size?: keyof typeof SIZE
  className?: string
}) {
  const s = findSupplier(supplierId)
  if (!s) return null
  return (
    <Monogram size={size} className={className}>
      {s.initials}
    </Monogram>
  )
}

const ORG_INITIALS: Record<string, string> = {
  "ws-levy": "L",
  "ws-chartwells": "C",
  "ws-compass": "CG",
}

export function WorkspaceAvatar({ ws, size = "lg", className }: { ws: Workspace; size?: keyof typeof SIZE; className?: string }) {
  if (ws.supplierId) return <SupplierLogo supplierId={ws.supplierId} size={size} className={className} />
  return (
    <Monogram size={size} className={className}>
      {ORG_INITIALS[ws.id] ?? ws.name[0]}
    </Monogram>
  )
}

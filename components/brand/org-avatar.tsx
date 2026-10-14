import { findSupplier } from "@/lib/reference"
import type { Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

/** The Instawork "W", drawn in the current ink so every partner mark shares one style. */
function InstaworkGlyph() {
  return (
    <svg viewBox="6 13 36 24" className="size-[62%]" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.314 16.2577C12.419 14.3912 10.1367 13.5841 8.21646 14.4548C6.29618 15.3256 5.46502 17.5445 6.36002 19.4109L13.2823 33.8466C14.1773 35.713 16.4595 36.5202 18.3798 35.6494C20.3001 34.7786 21.1313 32.5597 20.2363 30.6933L13.314 16.2577Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.2015 30.5978C22.1879 30.5677 22.1738 30.5377 22.1595 30.5078L17.969 21.7699L20.6283 16.2248C21.2846 14.8564 22.6866 14.0574 24.1449 14.0716C25.6031 14.0574 27.0051 14.8564 27.6614 16.2248L31.1565 23.5128L34.6859 16.1534C35.581 14.287 37.8633 13.4798 39.7836 14.3505C41.704 15.2212 42.5351 17.44 41.64 19.3064L34.7171 33.7418C34.3449 34.5177 33.7331 35.1106 33.0071 35.4759C32.9168 35.5259 32.8237 35.5727 32.7279 35.6161C30.8076 36.4868 28.5253 35.6796 27.6302 33.8132L24.1449 26.5456L22.2015 30.5978Z"
      />
    </svg>
  )
}

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
      {s.isInstawork ? <InstaworkGlyph /> : s.initials}
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

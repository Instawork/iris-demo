import { cn } from "@/lib/utils"

/** CrUber mark: an open "C" with the crew arriving in the gap. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--logo-tile)" />
      <path d="M21.4 11.4a6.7 6.7 0 1 0 0 9.2" fill="none" stroke="var(--logo-ink)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="22.8" cy="16" r="2.3" fill="var(--brand)" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("text-[16px] leading-none font-semibold tracking-[-0.03em] text-foreground", className)}>CrUber</span>
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-6" />
      {!collapsed && <Wordmark />}
    </span>
  )
}

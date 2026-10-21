import { cn } from "@/lib/utils"

/** Iris mark: a lime iris whose pupil glances up and ahead. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="dark:hidden" fill="var(--logo-tile)" />
      <path
        fill="var(--brand)"
        fillRule="evenodd"
        d="M16 6.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 1 0 0-18.8zm1.6 2.9a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 1 1 0-9.8z"
      />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("text-[16px] leading-none font-semibold tracking-[-0.04em] text-foreground", className)}>Iris</span>
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-6" />
      {!collapsed && <Wordmark />}
    </span>
  )
}

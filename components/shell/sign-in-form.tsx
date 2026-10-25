"use client"

import { ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { WorkspaceAvatar } from "@/components/brand/org-avatar"
import { LogoMark } from "@/components/brand/logo"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { WORKSPACES } from "@/lib/reference"
import type { Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

const GROUPS: { label: string; kind: Workspace["kind"]; hint: string }[] = [
  { label: "Buyers", kind: "buyer", hint: "Post shifts, approve hours, pay invoices" },
  { label: "Program office", kind: "compass", hint: "Rules, spend and invoice review across Compass" },
  { label: "Agencies", kind: "supplier", hint: "Staff shifts, keep workers compliant, get paid" },
]

export function SignInForm({ next, needsPasscode }: { next: string; needsPasscode: boolean }) {
  const router = useRouter()
  const [passcode, setPasscode] = useState("")
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()

  const signIn = async (ws: Workspace) => {
    if (needsPasscode && !passcode.trim()) {
      setError("Enter the demo passcode first.")
      return
    }
    setPending(ws.id)
    setError(undefined)
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, passcode: passcode.trim() }),
    }).catch(() => undefined)
    if (!res?.ok) {
      const body = (await res?.json().catch(() => undefined)) as { error?: string } | undefined
      setError(body?.error ?? "Couldn't reach Iris. Check the connection and try again.")
      setPending(undefined)
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <main className="flex h-full overflow-y-auto bg-page-faded">
      <div className="m-auto flex w-full max-w-[560px] flex-col gap-6 px-5 py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-11" />
          <div className="flex flex-col gap-1">
            <h1 className="text-featured-2 font-semibold">Sign in to Iris</h1>
            <p className="text-body-2 text-faded">Choose who you are. Each device can sign in as someone different.</p>
          </div>
        </div>

        {needsPasscode && (
          <label className="flex flex-col gap-1.5">
            <span className="text-caption-1 font-medium text-faded">Demo passcode</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              className="h-10"
            />
          </label>
        )}

        {error && <p className="rounded-lg bg-critical-faded px-3 py-2 text-body-3 text-critical-fg">{error}</p>}

        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <section key={group.kind} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-caption-1 font-semibold tracking-wide text-subtle uppercase">{group.label}</h2>
                <span className="text-caption-1 text-faded">{group.hint}</span>
              </div>
              <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-background">
                {WORKSPACES.filter((w) => w.kind === group.kind).map((w, i) => (
                  <li key={w.id} className={cn(i > 0 && "border-t border-border")}>
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => signIn(w)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-hover disabled:opacity-60"
                    >
                      <WorkspaceAvatar ws={w} size="md" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body-3 font-semibold">{w.user.name}</span>
                        <span className="truncate text-caption-1 text-faded">
                          {w.user.title} · {w.name}
                        </span>
                      </span>
                      {pending === w.id ? (
                        <Spinner className="size-4" />
                      ) : (
                        <ArrowRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}

"use client"

import { Coffee, LogIn, LogOut } from "lucide-react"
import { useEffect, useState } from "react"

import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { formatClock, formatDateLong, formatInterval, paidHours, spanMinutes } from "@/lib/dates"
import type { CheckInView, PunchAction } from "@/lib/domain/checkin"

/** The worker's phone at the venue. Each tap is Iris's own record of the time, separate from what the agency bills. */
export function CheckIn({ token }: { token: string }) {
  const [view, setView] = useState<CheckInView>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/check-in?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (!live) return
        if (ok) setView(body as CheckInView)
        else setError((body as { error?: string }).error ?? "This check-in link isn't valid.")
      })
      .catch(() => live && setError("Iris is offline. Check the connection and try again."))
    return () => {
      live = false
    }
  }, [token])

  const act = async (action: PunchAction) => {
    setBusy(true)
    setError(undefined)
    const res = await fetch("/api/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }) })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) setView(body as CheckInView)
    else setError((body as { error?: string }).error ?? "Iris couldn't record that punch. Try again.")
  }

  const p = view?.punches ?? {}
  const onBreak = !!p.breakStart && !p.breakEnd
  const breakMins = p.breakStart && p.breakEnd ? spanMinutes(p.breakStart, p.breakEnd) : 0
  const worked = p.in && p.out ? paidHours(p.in, p.out, breakMins) : undefined

  return (
    <main className="flex min-h-svh flex-col items-center bg-background px-5 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="text-body-2 font-semibold">Iris check-in</span>
        </div>

        {view ? (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-featured-2 font-semibold">{view.proName}</h1>
              <p className="text-body-3 text-faded">
                {view.position} at {view.location} for {view.agency}
              </p>
              <p className="text-body-3 text-faded">
                {formatDateLong(view.date)} · {formatInterval(view.start, view.end, view.tz)}
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
              <span className="text-caption-1 font-semibold tracking-wide text-faded uppercase">{p.out ? "Clocked out" : onBreak ? "On break" : p.in ? "Clocked in" : "Not clocked in"}</span>
              <dl className="grid grid-cols-2 gap-y-2 text-body-3">
                <dt className="text-faded">Clock-in</dt>
                <dd className="text-right font-semibold tabular">{p.in ? formatClock(p.in) : "--"}</dd>
                {(p.breakStart || p.breakEnd) && (
                  <>
                    <dt className="text-faded">Break</dt>
                    <dd className="text-right font-semibold tabular">
                      {p.breakStart ? formatClock(p.breakStart) : "--"} – {p.breakEnd ? formatClock(p.breakEnd) : "now"}
                    </dd>
                  </>
                )}
                <dt className="text-faded">Clock-out</dt>
                <dd className="text-right font-semibold tabular">{p.out ? formatClock(p.out) : "--"}</dd>
                {worked !== undefined && (
                  <>
                    <dt className="text-faded">Worked</dt>
                    <dd className="text-right font-semibold tabular">{worked.toFixed(2)} hrs</dd>
                  </>
                )}
              </dl>
            </div>

            {view.closed || p.out ? (
              <p className="rounded-xl bg-positive-faded px-4 py-3 text-body-3 text-positive-fg">You&apos;re clocked out. Iris sent your hours to {view.agency}. Thanks for working the shift.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {!p.in && (
                  <Button className="h-14 gap-2 rounded-xl text-body-1 font-semibold" disabled={busy} onClick={() => act("in")}>
                    <LogIn className="size-5" /> Clock in
                  </Button>
                )}
                {p.in && !p.breakStart && (
                  <Button variant="outline" className="h-12 gap-2 rounded-xl text-body-2" disabled={busy} onClick={() => act("break_start")}>
                    <Coffee className="size-5" /> Start break
                  </Button>
                )}
                {onBreak && (
                  <Button variant="outline" className="h-12 gap-2 rounded-xl text-body-2" disabled={busy} onClick={() => act("break_end")}>
                    <Coffee className="size-5" /> End break
                  </Button>
                )}
                {p.in && (
                  <Button className="h-14 gap-2 rounded-xl text-body-1 font-semibold" disabled={busy} onClick={() => act("out")}>
                    <LogOut className="size-5" /> Clock out
                  </Button>
                )}
              </div>
            )}
            {error && <p className="text-body-3 text-critical-fg">{error}</p>}
            <p className="text-caption-1 text-subtle">Iris keeps this record for the venue. Your agency bills from its own records, and the venue checks the two against each other.</p>
          </>
        ) : (
          <p className="text-body-3 text-faded">{error ?? "Loading your shift…"}</p>
        )}
      </div>
    </main>
  )
}

import { checkInView, punch, type PunchAction } from "@/lib/domain/checkin"
import { CommandError } from "@/lib/domain/commands"
import { verifyValue } from "@/lib/session-token"
import type { DemoData } from "@/lib/types"
import { getTenant } from "@/server/tenant"

export const dynamic = "force-dynamic"

const ACTIONS: PunchAction[] = ["in", "break_start", "break_end", "out"]

/** The signed link stands in for a sign-in: it names one worker's spot on one shift, and nothing else. */
async function spotOf(token: unknown) {
  const value = typeof token === "string" ? await verifyValue(token) : null
  const [groupId, slotId] = value?.split("|") ?? []
  return groupId && slotId ? { groupId, slotId } : null
}

const invalid = () => Response.json({ error: "This check-in link isn't valid." }, { status: 404 })

export async function GET(request: Request) {
  const spot = await spotOf(new URL(request.url).searchParams.get("token"))
  if (!spot) return invalid()
  const tenant = await getTenant()
  try {
    return Response.json(checkInView(tenant.data, spot.groupId, spot.slotId), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof CommandError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; action?: unknown } | null
  const spot = await spotOf(body?.token)
  if (!spot) return invalid()
  const action = ACTIONS.find((a) => a === body?.action)
  if (!action) return Response.json({ error: "Unknown punch." }, { status: 400 })
  const tenant = await getTenant()
  try {
    const applied = await tenant.mutate({ kind: "punch", actor: "Iris check-in", input: { ...spot, action } }, (data: DemoData) => punch(data, spot.groupId, spot.slotId, action, new Date()))
    return Response.json(applied.result)
  } catch (error) {
    if (error instanceof CommandError) return Response.json({ error: error.message }, { status: error.status })
    console.error("[iris] punch failed", error)
    return Response.json({ error: "Iris couldn't record that punch. Try again." }, { status: 500 })
  }
}

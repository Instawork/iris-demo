import { startLiveShift } from "@/lib/domain/checkin"
import { CommandError } from "@/lib/domain/commands"
import { signValue } from "@/lib/session-token"
import type { DemoData } from "@/lib/types"
import { currentSession, unauthorized } from "@/server/session"
import { getTenant } from "@/server/tenant"

export const dynamic = "force-dynamic"

/** Presenter control: a shift in progress with a worker clocked in, and the link their phone opens to clock out. */
export async function POST() {
  const session = await currentSession()
  if (!session) return unauthorized()
  const tenant = await getTenant(session.tenantId)
  try {
    const applied = await tenant.mutate({ kind: "startLiveShift", actor: session.ws.user.name, workspaceId: session.ws.id }, (data: DemoData) => startLiveShift(data, new Date()))
    const { groupId, slotId } = applied.result
    return Response.json({ groupId, path: `/check-in/${await signValue(`${groupId}|${slotId}`)}` })
  } catch (error) {
    if (error instanceof CommandError) return Response.json({ error: error.message }, { status: error.status })
    console.error("[iris] live shift failed", error)
    return Response.json({ error: "Iris couldn't start the live shift." }, { status: 500 })
  }
}

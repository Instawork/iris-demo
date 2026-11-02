import { currentSession, unauthorized } from "@/server/session"
import { getTenant } from "@/server/tenant"

export const dynamic = "force-dynamic"

const NAME = /^[a-z][a-z0-9-]{0,39}$/

/**
 * Presenter control for the guided demo: keeps the data as it is at the start of a step, or puts it back, so any step
 * can be played again from where it began.
 */
export async function POST(request: Request) {
  const session = await currentSession()
  if (!session) return unauthorized()
  const body = (await request.json().catch(() => null)) as { name?: unknown; restore?: unknown } | null
  const name = typeof body?.name === "string" && NAME.test(body.name) ? body.name : undefined
  if (!name) return Response.json({ error: "Unknown step." }, { status: 400 })
  const tenant = await getTenant(session.tenantId)
  try {
    if (body?.restore !== true) {
      await tenant.checkpoint(name)
      return Response.json({ ok: true })
    }
    const applied = await tenant.restore({ kind: "restoreCheckpoint", actor: session.ws.user.name, workspaceId: session.ws.id, input: { name } }, name)
    return Response.json({ ok: true, ...applied })
  } catch (error) {
    console.error(`[iris] checkpoint ${name} failed`, error)
    return Response.json({ error: "Iris couldn't set that step up." }, { status: 500 })
  }
}

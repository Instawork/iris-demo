import { CommandError, isCommandName, runCommand } from "@/lib/domain/commands"
import type { DemoData } from "@/lib/types"
import { currentSession, unauthorized } from "@/server/session"
import { getTenant } from "@/server/tenant"

export const dynamic = "force-dynamic"

/** Every write in Iris comes through here: the signed-in workspace, one named command, checked and applied on the server. */
export async function POST(request: Request) {
  const session = await currentSession()
  if (!session) return unauthorized()
  const body = (await request.json().catch(() => null)) as { type?: unknown; input?: unknown; key?: unknown } | null
  if (!body || !isCommandName(body.type)) return Response.json({ error: "Unknown command." }, { status: 400 })
  const type = body.type
  const tenant = await getTenant(session.tenantId)
  const key = typeof body.key === "string" && body.key.length <= 100 ? `${session.ws.id}:${body.key}` : undefined
  const previous = key ? tenant.rememberedResult(key) : undefined
  if (previous) return Response.json({ ok: true, ...previous, repeated: true })
  try {
    const applied = await tenant.mutate({ kind: type, actor: session.ws.user.name, workspaceId: session.ws.id, input: body.input }, (data: DemoData) =>
      runCommand(type, data, { ws: session.ws, now: new Date().toISOString() }, body.input as never),
    )
    if (key) tenant.remember(key, applied)
    if (type === "resetDemo") await tenant.beginRun()
    return Response.json({ ok: true, ...applied })
  } catch (error) {
    if (error instanceof CommandError) return Response.json({ error: error.message }, { status: error.status })
    console.error(`[iris] command ${type} failed`, error)
    return Response.json({ error: "Iris couldn't save that. Try again." }, { status: 500 })
  }
}

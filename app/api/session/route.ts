import { currentSession, endSession, passcodeMatches, startSession } from "@/server/session"

export const dynamic = "force-dynamic"

/** Signs in as a demo workspace, or switches workspace when already signed in. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { workspaceId?: unknown; passcode?: unknown }
  const existing = await currentSession()
  if (!existing && !passcodeMatches(body.passcode)) return Response.json({ error: "That passcode isn't right." }, { status: 401 })
  if (typeof body.workspaceId !== "string") return Response.json({ error: "Choose a workspace." }, { status: 400 })
  const ws = await startSession(body.workspaceId)
  if (!ws) return Response.json({ error: "That workspace doesn't exist." }, { status: 404 })
  return Response.json({ workspaceId: ws.id })
}

export async function DELETE() {
  await endSession()
  return Response.json({ ok: true })
}

import { currentSession, unauthorized } from "@/server/session"
import { getTenant } from "@/server/tenant"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await currentSession()
  if (!session) return unauthorized()
  const tenant = await getTenant(session.tenantId)
  return Response.json({ version: tenant.version, data: tenant.data, workspaceId: session.ws.id }, { headers: { "Cache-Control": "no-store" } })
}

import { cookies } from "next/headers"

import { findWorkspace } from "@/lib/reference"
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "@/lib/session-token"
import type { Workspace } from "@/lib/types"
import { defaultTenantId, getTenant } from "@/server/tenant"

export interface Session {
  ws: Workspace
  tenantId: string
}

/** Agencies onboarded in the tenant's data have workspaces too, so the tenant loads before a workspace is looked up. */
export async function currentSession(): Promise<Session | null> {
  const store = await cookies()
  const payload = await verifySession(store.get(SESSION_COOKIE)?.value)
  if (payload) await getTenant(payload.tenant)
  const ws = payload && findWorkspace(payload.ws)
  return payload && ws ? { ws, tenantId: payload.tenant } : null
}

export async function startSession(workspaceId: string) {
  await getTenant(defaultTenantId())
  const ws = findWorkspace(workspaceId)
  if (!ws) return null
  const token = await signSession({ ws: ws.id, tenant: defaultTenantId(), iat: Math.floor(Date.now() / 1000) })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
  return ws
}

export async function endSession() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export const unauthorized = () => Response.json({ error: "Sign in to continue." }, { status: 401 })

/** A passcode keeps the hosted demo private. Unset in local development. */
export const passcodeRequired = () => !!process.env.IRIS_DEMO_PASSCODE
export const passcodeMatches = (value: unknown) => !passcodeRequired() || value === process.env.IRIS_DEMO_PASSCODE

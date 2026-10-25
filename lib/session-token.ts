/** Signed session cookie shared by the proxy and route handlers. Web Crypto only, so it runs in either runtime. */

export const SESSION_COOKIE = "iris_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

export interface SessionPayload {
  /** Workspace the user signed in as. */
  ws: string
  tenant: string
  iat: number
}

const encoder = new TextEncoder()

const base64url = (bytes: Uint8Array) => {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const fromBase64url = (text: string) => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export const sessionSecret = () => process.env.IRIS_SESSION_SECRET || "iris-local-development-secret"

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))
}

export async function signSession(payload: SessionPayload, secret = sessionSecret()) {
  const body = base64url(encoder.encode(JSON.stringify(payload)))
  return `${body}.${base64url(await hmac(secret, body))}`
}

export async function verifySession(token: string | undefined, secret = sessionSecret()): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, signature] = token.split(".")
  if (!body || !signature) return null
  const expected = base64url(await hmac(secret, body))
  if (expected.length !== signature.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionPayload
    if (typeof payload.ws !== "string" || typeof payload.tenant !== "string") return null
    if (Date.now() / 1000 - payload.iat > SESSION_MAX_AGE) return null
    return payload
  } catch {
    return null
  }
}

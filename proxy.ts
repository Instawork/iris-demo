import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE, verifySession } from "@/lib/session-token"

/** Sends anyone without a valid session to sign in. API routes check the session themselves and answer 401. */
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()
  const url = request.nextUrl.clone()
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`
  url.pathname = "/sign-in"
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!api|sign-in|check-in|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
}

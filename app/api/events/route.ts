import { currentSession, unauthorized } from "@/server/session"
import { getTenant, type TenantEvent } from "@/server/tenant"

export const dynamic = "force-dynamic"

const encoder = new TextEncoder()

/** Server-sent events: every change to the tenant, in order, to every signed-in device. */
export async function GET(request: Request) {
  const session = await currentSession()
  if (!session) return unauthorized()
  const tenant = await getTenant(session.tenantId)
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const send = (event: TenantEvent) => write(`id: ${event.version}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`)
      const unsubscribe = tenant.subscribe(send, session.ws.id)
      const ping = setInterval(() => write(`: ping\n\n`), 15_000)
      cleanup = () => {
        clearInterval(ping)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      request.signal.addEventListener("abort", () => cleanup())
      write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ version: tenant.version })}\n\n`)
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

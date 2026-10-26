"use client"

import { usePathname } from "next/navigation"
import { MessageSquare } from "lucide-react"
import { useEffect } from "react"

import { AgentComposer, AgentMessages } from "@/components/agent/agent-thread"
import { useAgent } from "@/components/agent/use-agent"
import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"

export const AGENT_PROMPTS = {
  buyer: ["Create a shift", "Upload shifts", "Download shift template", "Approve hours"],
  supplier: ["Upload rate card", "Upload professionals", "Assign Pros", "Submit hours"],
  compass: ["Spend by agency last month", "Review flagged invoices", "Show safety exceptions", "Download activity template"],
}

const INTRO = {
  compass: "I can build a report from a question, and help you investigate spend, flagged invoices and workforce safety across the Compass program.",
  buyer: "I can create or upload shifts, approve hours that match the clock, and provide the right CSV template.",
  supplier: "I can help upload rates and Pros, assign Pros to shifts, and submit hours or tips.",
}

/** Agent Chat on every page but Home, where the agent is the page itself. */
export function AgentChat() {
  const pathname = usePathname()
  const { ws } = useWorkspace()
  const open = useUi((state) => state.agentOpen)
  const setOpen = useUi((state) => state.setAgentOpen)
  const agent = useAgent()

  useEffect(() => {
    if (pathname === "/") return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j") return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pathname, setOpen])

  if (pathname === "/") return null

  return (
    <>
      <Button className="fixed right-5 bottom-5 z-40 h-11 gap-2 rounded-lg px-4 shadow-lg" onClick={() => setOpen(true)} aria-label="Open Agent Chat">
        <MessageSquare className="size-4" />
        <span className="hidden sm:inline">Agent Chat</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="gap-0 p-0 data-[side=right]:w-[min(100%,440px)] data-[side=right]:sm:max-w-[440px]">
          <SheetHeader className="border-b border-border px-5 py-4">
            <span className="flex items-center gap-2">
              <LogoMark className="size-8" />
              <span>
                <SheetTitle>Agent Chat</SheetTitle>
                <SheetDescription>Guidance with approval before changes</SheetDescription>
              </span>
            </span>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 scrollbar-thin">
              <AgentMessages compact onRun={agent.runAction} messages={[{ id: 0, from: "agent", text: INTRO[ws.kind] }, ...agent.messages]} />
            </div>
            <div className="flex flex-col gap-3 border-t border-border bg-page-faded p-4">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {AGENT_PROMPTS[ws.kind].map((prompt) => (
                  <Button key={prompt} variant="outline" size="sm" className="bg-background" onClick={() => agent.respond(prompt)}>
                    {prompt}
                  </Button>
                ))}
              </div>
              <AgentComposer label="Message Agent Chat" placeholder="Ask what to do or describe a shift…" onSubmit={agent.respond} onAttach={agent.attach} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

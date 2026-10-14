"use client"

import { useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ReviewFixes } from "@/components/uploads/review-fixes"
import { UploadPicker, defaultUploadType } from "@/components/uploads/upload-picker"
import { useUploadFlow, type ReviewSession } from "@/components/uploads/use-upload-flow"
import { useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import type { UploadType } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Opened from anywhere with useUi.getState().openUpload(type?): pick a file, review fixes if any, saved. */
export function UploadDialog() {
  const open = useUi((s) => s.uploadOpen)
  const preset = useUi((s) => s.uploadType)
  const close = useUi((s) => s.closeUpload)
  const { ws } = useWorkspace()
  const flow = useUploadFlow()
  const [type, setType] = useState<UploadType>(() => defaultUploadType(ws, preset))
  const [session, setSession] = useState<ReviewSession>()
  const [shown, setShown] = useState(open)
  if (open !== shown) {
    setShown(open)
    if (open) {
      setType(defaultUploadType(ws, preset))
      setSession(undefined)
    }
  }

  const dismiss = () => {
    if (session) flow.hold(session)
    close()
  }

  const upload = (t: UploadType, fileName: string, csv: string) => {
    const result = flow.submit(t, fileName, csv)
    if (result.status === "review") setSession(result.session)
    if (result.status === "saved") close()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className={cn("max-h-[92svh] gap-0 overflow-hidden p-0", session ? "sm:max-w-4xl" : "sm:max-w-2xl")}>
        {session ? (
          <ReviewFixes key={`${session.id}-${session.round}`} session={session} onChange={setSession} onDone={close} />
        ) : (
          <>
            <div className="flex flex-col gap-1 border-b border-border px-6 pt-5 pr-12 pb-4">
              <DialogTitle className="text-featured-3 font-bold">Upload a CSV</DialogTitle>
              <DialogDescription className="text-body-3 text-faded">Every row is checked, and you approve any fixes before anything is saved.</DialogDescription>
            </div>
            <UploadPicker type={type} onTypeChange={setType} onUpload={upload} className="m-6" />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

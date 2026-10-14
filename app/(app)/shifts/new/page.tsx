"use client"

import Link from "next/link"
import { Suspense } from "react"
import { Lock } from "lucide-react"

import { EmptyState } from "@/components/common/empty-state"
import { BookingWizard } from "@/components/shifts/booking-wizard"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/hooks/use-app"

export default function Page() {
  const { ws } = useWorkspace()
  if (ws.kind !== "buyer") {
    return (
      <div className="pt-10">
        <EmptyState
          icon={Lock}
          title="Booking is for buyers"
          description="Switch to a buyer workspace like Levy · Chicago to book Pros."
          actions={
            <Button asChild variant="outline">
              <Link href="/shifts">Back to Shifts</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <Suspense>
      <BookingWizard />
    </Suspense>
  )
}

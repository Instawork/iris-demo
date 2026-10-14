import { Suspense } from "react"

import { ShiftsPage } from "@/components/shifts/shifts-page"

export const metadata = { title: "Shifts" }

export default function Page() {
  return (
    <Suspense>
      <ShiftsPage />
    </Suspense>
  )
}

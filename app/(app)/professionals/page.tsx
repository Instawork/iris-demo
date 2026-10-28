import { Suspense } from "react"

import { ProfessionalsPage } from "@/components/pros/professionals-page"

export const metadata = { title: "Workers" }

export default function Page() {
  return (
    <Suspense>
      <ProfessionalsPage />
    </Suspense>
  )
}

import { Suspense } from "react"

import { ProfessionalsPage } from "@/components/pros/professionals-page"

export const metadata = { title: "Professionals" }

export default function Page() {
  return (
    <Suspense>
      <ProfessionalsPage />
    </Suspense>
  )
}

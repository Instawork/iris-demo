import { Suspense } from "react"

import { NewUnitPage } from "@/components/onboarding/unit-form"

export const metadata = { title: "Add a unit" }

export default function Page() {
  return (
    <Suspense>
      <NewUnitPage />
    </Suspense>
  )
}

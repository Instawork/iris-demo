import { Suspense } from "react"

import { UnitsPage } from "@/components/onboarding/onboarding-page"

export const metadata = { title: "Units" }

export default function Page() {
  return (
    <Suspense>
      <UnitsPage />
    </Suspense>
  )
}

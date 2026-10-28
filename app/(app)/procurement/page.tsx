import { Suspense } from "react"

import { ProcurementPage } from "@/components/procurement/procurement-page"

export const metadata = { title: "Procurement" }

export default function Page() {
  return (
    <Suspense>
      <ProcurementPage />
    </Suspense>
  )
}

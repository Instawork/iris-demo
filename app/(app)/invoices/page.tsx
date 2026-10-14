import { Suspense } from "react"

import { InvoicesPage } from "@/components/invoices/invoices-page"

export const metadata = { title: "Invoices" }

export default function Page() {
  return (
    <Suspense>
      <InvoicesPage />
    </Suspense>
  )
}

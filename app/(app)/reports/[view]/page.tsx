import { redirect } from "next/navigation"
import { Suspense } from "react"

import { ReportPageView } from "@/components/reports/report-page"
import { isReportView, pageHref } from "@/lib/reports"

export const metadata = { title: "Reports" }

export default async function Page({ params }: PageProps<"/reports/[view]">) {
  const { view } = await params
  if (!isReportView(view)) redirect(pageHref("scorecard"))
  return (
    <Suspense>
      <ReportPageView view={view} />
    </Suspense>
  )
}

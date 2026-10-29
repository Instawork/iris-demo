import { redirect } from "next/navigation"

import { pageHref, reportHref, specFromParams } from "@/lib/reports"

export default async function Page({ searchParams }: PageProps<"/reports">) {
  const given = await searchParams
  const params = new URLSearchParams(Object.entries(given).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])))
  const spec = specFromParams(params)
  redirect(spec ? reportHref(spec) : pageHref("scorecard"))
}

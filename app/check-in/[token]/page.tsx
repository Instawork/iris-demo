import type { Metadata } from "next"

import { CheckIn } from "@/components/timesheets/check-in"

export const metadata: Metadata = { title: "Check in" }

export const dynamic = "force-dynamic"

export default async function CheckInPage({ params }: PageProps<"/check-in/[token]">) {
  const { token } = await params
  return <CheckIn token={token} />
}

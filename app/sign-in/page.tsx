import type { Metadata } from "next"

import { SignInForm } from "@/components/shell/sign-in-form"
import { passcodeRequired } from "@/server/session"

export const metadata: Metadata = { title: "Sign in" }

export const dynamic = "force-dynamic"

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/"
  return <SignInForm next={next} needsPasscode={passcodeRequired()} />
}

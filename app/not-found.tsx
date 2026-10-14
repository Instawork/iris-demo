import Link from "next/link"

import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-page-faded px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex flex-col gap-1">
        <h1 className="text-featured-2 font-bold">We couldn&apos;t find that page</h1>
        <p className="text-body-2 text-faded">The link may be out of date, or the page has moved.</p>
      </div>
      <Button asChild className="h-9 rounded-lg px-4 text-body-3 font-semibold">
        <Link href="/">Back to Home</Link>
      </Button>
    </main>
  )
}

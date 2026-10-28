"use client"

import { Suspense } from "react"

import { RatesPage } from "@/components/rates/rates-page"

export default function Page() {
  return (
    <Suspense>
      <RatesPage />
    </Suspense>
  )
}

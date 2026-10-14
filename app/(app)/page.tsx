"use client"

import { BuyerHome } from "@/components/home/buyer-home"
import { CompassHome } from "@/components/home/compass-home"
import { SupplierHome } from "@/components/home/supplier-home"
import { useWorkspace } from "@/hooks/use-app"

export default function HomePage() {
  const { ws } = useWorkspace()
  if (ws.kind === "supplier") return <SupplierHome />
  if (ws.kind === "compass") return <CompassHome />
  return <BuyerHome />
}

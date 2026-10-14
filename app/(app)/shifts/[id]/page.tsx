import { ShiftDetail } from "@/components/shifts/shift-detail"

export const metadata = { title: "Shift" }

export default async function Page({ params }: PageProps<"/shifts/[id]">) {
  const { id } = await params
  return <ShiftDetail id={id} />
}

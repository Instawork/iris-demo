import { EventPage } from "@/components/procurement/event-page"

export const metadata = { title: "Sourcing event" }

export default async function Page({ params }: PageProps<"/procurement/[id]">) {
  const { id } = await params
  return <EventPage id={id} />
}

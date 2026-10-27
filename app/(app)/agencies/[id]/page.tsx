import { AgencyPage } from "@/components/agencies/agency-page"

export const metadata = { title: "Agency" }

export default async function Page({ params }: PageProps<"/agencies/[id]">) {
  const { id } = await params
  return <AgencyPage id={id} />
}

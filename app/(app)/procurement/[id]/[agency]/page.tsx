import { AgencyBidPage } from "@/components/procurement/agency-bid-page"

export const metadata = { title: "Agency bid" }

export default async function Page({ params }: PageProps<"/procurement/[id]/[agency]">) {
  const { id, agency } = await params
  return <AgencyBidPage id={id} supplierId={agency} />
}

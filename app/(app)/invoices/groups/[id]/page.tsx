import { InvoiceGroupPage } from "@/components/invoices/group-page"

export const metadata = { title: "Invoice group" }

export default async function Page({ params }: PageProps<"/invoices/groups/[id]">) {
  const { id } = await params
  return <InvoiceGroupPage id={id} />
}

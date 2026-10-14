import { InvoiceDetail } from "@/components/invoices/invoice-detail"

export const metadata = { title: "Invoice" }

export default async function Page({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params
  return <InvoiceDetail id={id} />
}

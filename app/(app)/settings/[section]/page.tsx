import { SettingsPage } from "@/components/settings/settings-page"

export const metadata = { title: "Settings" }

export default async function Page({ params }: PageProps<"/settings/[section]">) {
  const { section } = await params
  return <SettingsPage section={section} />
}

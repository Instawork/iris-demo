import { redirect } from "next/navigation"

export default function Page() {
  redirect("/shifts?filter=hours")
}

import { formatDateFull } from "@/lib/dates"
import { fullName } from "@/lib/format"
import type { Pro, RequirementId } from "@/lib/types"
import { readDocument } from "@/lib/verification"

/**
 * A photo of a worker's certificate, drawn rather than shipped, so the demo can drop a believable one into the upload
 * without a real person's document. It carries what the issuer has on file, so what Iris reads matches what it checks.
 */

export const CERT_TITLE: Partial<Record<RequirementId, string>> = {
  foodHandler: "Food Handler Certificate",
  alcohol: "Responsible Alcohol Server",
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)

export function certificateFile(pro: Pro, requirement: RequirementId, today: string) {
  const doc = readDocument(requirement, pro.id, today)
  const title = CERT_TITLE[requirement] ?? "Certificate"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
<rect width="640" height="420" rx="18" fill="#fbf8f1"/>
<rect x="16" y="16" width="608" height="388" rx="12" fill="none" stroke="#1f4f46" stroke-width="3"/>
<rect x="28" y="28" width="584" height="364" rx="8" fill="none" stroke="#c7b98d" stroke-width="1.5"/>
<text x="320" y="92" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#1f4f46">${escape(title)}</text>
<text x="320" y="132" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" letter-spacing="3" fill="#7a7158">THIS CERTIFIES THAT</text>
<text x="320" y="190" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="40" fill="#1d1d1b">${escape(fullName(pro))}</text>
<line x1="150" y1="210" x2="490" y2="210" stroke="#c7b98d" stroke-width="1.5"/>
<text x="320" y="244" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#4a463b">has completed the required training and examination</text>
<text x="80" y="318" font-family="Helvetica, Arial, sans-serif" font-size="12" letter-spacing="2" fill="#7a7158">CERTIFICATE NO.</text>
<text x="80" y="344" font-family="Courier New, monospace" font-size="20" fill="#1d1d1b">${escape(doc.reference)}</text>
<text x="330" y="318" font-family="Helvetica, Arial, sans-serif" font-size="12" letter-spacing="2" fill="#7a7158">ISSUED</text>
<text x="330" y="344" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#1d1d1b">${escape(formatDateFull(doc.issuedOn))}</text>
${doc.expiresOn ? `<text x="480" y="318" font-family="Helvetica, Arial, sans-serif" font-size="12" letter-spacing="2" fill="#7a7158">EXPIRES</text>
<text x="480" y="344" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#1d1d1b">${escape(formatDateFull(doc.expiresOn))}</text>` : ""}
<circle cx="560" cy="100" r="34" fill="none" stroke="#1f4f46" stroke-width="2.5"/>
<circle cx="560" cy="100" r="26" fill="#1f4f46" opacity="0.12"/>
</svg>`
  const name = `${pro.firstName}_${title.replace(/\s+/g, "_")}.jpg`
  return new File([svg], name, { type: "image/svg+xml" })
}

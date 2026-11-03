import { addDaysISO, formatDateFull } from "@/lib/dates"
import { hashString } from "@/lib/random"
import type { RequirementId } from "@/lib/types"

/**
 * How Iris checks each kind of document before it clears a Pro: who issues it, what reference identifies it, and how
 * long it lasts. Background checks, training and certifications are verified through Chkr. Work authorization is the
 * agency's to attest, as the employer that completes the I-9. The provider lookups are simulated in the demo; what
 * passes and what gets held for Compass are the rules Iris applies.
 */

export interface DocumentCheck {
  providers: string[]
  reference: { label: string; placeholder: string; pattern: RegExp }
  issuedLabel: string
  /** Renewable documents last this long from the day they're issued. */
  validYears?: number
  /** The agency attests it. Anything else Iris asks the issuer for directly. */
  attested?: boolean
}

export const CHECKS: Record<RequirementId, DocumentCheck> = {
  background: {
    providers: ["Chkr"],
    reference: { label: "Report ID", placeholder: "STR-4831207", pattern: /^[A-Z]{2,4}-?\d{6,9}$/i },
    issuedLabel: "Completed on",
    validYears: 1,
  },
  i9: {
    providers: ["Form I-9"],
    reference: { label: "Form", placeholder: "I-9", pattern: /^I-9$/ },
    issuedLabel: "Attested on",
    attested: true,
  },
  orientation: {
    providers: ["Compass Learning"],
    reference: { label: "Completion ID", placeholder: "CL-208114", pattern: /^CL-?\d{5,8}$/i },
    issuedLabel: "Completed on",
  },
  foodHandler: {
    providers: ["Chkr"],
    reference: { label: "Certificate number", placeholder: "21894570", pattern: /^\d{7,10}$/ },
    issuedLabel: "Issued on",
    validYears: 3,
  },
  alcohol: {
    providers: ["Chkr"],
    reference: { label: "Certificate number", placeholder: "B-7781204", pattern: /^[A-Z]?-?\d{6,9}$/i },
    issuedLabel: "Issued on",
    validYears: 3,
  },
}

export const expiryFor = (requirement: RequirementId, issuedOn: string) => {
  const years = CHECKS[requirement].validYears
  return years ? addDaysISO(issuedOn, Math.round(365.25 * years)) : undefined
}

export type CheckResult = { result: "verified" } | { result: "needs_review"; reason: string }

/** What the provider says about the document, or that the agency attested it. */
export function checkDocument(requirement: RequirementId, doc: { provider: string; reference: string; issuedOn: string; expiresOn?: string }, today: string): CheckResult {
  const check = CHECKS[requirement]
  const reference = doc.reference.trim()
  if (!check.providers.includes(doc.provider)) return { result: "needs_review", reason: `Iris doesn't check ${doc.provider} documents yet` }
  if (!check.reference.pattern.test(reference)) return { result: "needs_review", reason: `${doc.provider} has no record of ${reference || "that reference"}` }
  if (doc.issuedOn > today) return { result: "needs_review", reason: `${doc.provider} shows it issued later than the date given` }
  const expires = doc.expiresOn ?? expiryFor(requirement, doc.issuedOn)
  if (expires && expires <= today) return { result: "needs_review", reason: `${doc.provider} shows it expired ${formatDateFull(expires)}` }
  return { result: "verified" }
}

/** What the issuer has on file for a Pro. Stable for one Pro and document, so a retry finds the same thing. */
export function readDocument(requirement: RequirementId, proId: string, today: string) {
  const check = CHECKS[requirement]
  const n = hashString(`${proId}:${requirement}`)
  const provider = check.providers[n % check.providers.length]
  const digits = String(100000000 + (n % 899999999)).slice(-8)
  const reference =
    requirement === "background"
      ? `${provider.slice(0, 3).toUpperCase()}-${digits.slice(0, 7)}`
      : requirement === "i9"
        ? "I-9"
        : requirement === "orientation"
          ? `CL-${digits.slice(0, 6)}`
          : requirement === "alcohol"
            ? `B-${digits.slice(0, 7)}`
            : digits
  const issuedOn = addDaysISO(today, -(n % 5))
  return { provider, reference, issuedOn, expiresOn: expiryFor(requirement, issuedOn) }
}

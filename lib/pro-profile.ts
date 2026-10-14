import { differenceInCalendarDays, subMonths } from "date-fns"

import { readiness, requirementRows, summaryOf, type RequirementRow } from "@/lib/compliance"
import { addDaysISO, parseDate, toISODate, todayISO } from "@/lib/dates"
import { plural, roundTo } from "@/lib/format"
import { createRandom, hashString } from "@/lib/random"
import { POSITIONS, city, position, supplier } from "@/lib/reference"
import type { ComplianceState, PositionCategory, Pro, RateCard, RequirementId } from "@/lib/types"

/* -------------------------------- Onboarding ------------------------------- */

export interface OnboardingStatus {
  complete: boolean
  steps: RequirementRow[]
  left: number
  label: string
}

/** Onboarding ends when the last required document clears and the Pro turns active. */
export function onboardingOf(pro: Pro): OnboardingStatus {
  if (pro.status === "active") return { complete: true, steps: [], left: 0, label: "Complete" }
  const steps = readiness(pro).blockers
  const left = Math.max(1, steps.length)
  return { complete: false, steps, left, label: `${plural(left, "step")} left` }
}

/* -------------------------------- Compliance ------------------------------- */

export interface ComplianceStatus {
  label: string
  tone: "positive" | "warning" | "critical"
  issues: RequirementRow[]
}

const SHORT: Record<RequirementId, string> = {
  background: "BGC",
  i9: "I-9",
  orientation: "orientation",
  foodHandler: "food handler",
  alcohol: "alcohol cert",
}

const ISSUE_ORDER: ComplianceState[] = ["expired", "missing", "pending", "expiring"]

const ISSUE_WORD: Record<ComplianceState, string> = {
  expired: "Expired",
  missing: "Missing",
  pending: "Pending",
  expiring: "Expiring",
  complete: "Complete",
  not_required: "Not required",
}

/** One short label per Pro, led by the most serious document problem: "Missing BGC", "Expiring food handler". */
export function complianceOf(pro: Pro): ComplianceStatus {
  const issues = requirementRows(pro)
    .filter((r) => ISSUE_ORDER.includes(r.state))
    .sort((a, b) => ISSUE_ORDER.indexOf(a.state) - ISSUE_ORDER.indexOf(b.state))
  const top = issues[0]
  if (!top) return { label: "Compliant", tone: "positive", issues }
  return {
    label: `${ISSUE_WORD[top.state]} ${SHORT[top.id]}`,
    tone: top.state === "expired" || top.state === "missing" ? "critical" : "warning",
    issues,
  }
}

export type ProStanding = "onboarding" | "not_compliant" | "compliant"

/** Every Pro is in exactly one group: still onboarding, blocked by a document, or cleared to work. */
export function standingOf(pro: Pro): ProStanding {
  const s = summaryOf(pro)
  return s === "onboarding" ? "onboarding" : s === "action_needed" ? "not_compliant" : "compliant"
}

/* ------------------------ Resume, interviews, offers ----------------------- */

export interface ResumeJob {
  employer: string
  role: string
  from: string
  to?: string
}

export interface ProResume {
  headline: string
  years: number
  jobs: ResumeJob[]
  skills: string[]
  certifications: string[]
}

export interface ProInterview {
  id: string
  date: string
  interviewer: string
  mode: "phone" | "in_person"
  outcome: "passed" | "follow_up"
  note: string
}

export interface ProOffer {
  id: string
  positionId: string
  payRate: number
  date: string
  status: "accepted" | "declined" | "pending"
}

export interface ProProfile {
  resume: ProResume
  interviews: ProInterview[]
  offers: ProOffer[]
}

const EMPLOYERS: Record<string, string[]> = {
  chi: ["Lakeshore Grand Hotel", "Fulton Market Kitchen", "Wrigleyville Tap House", "Union Station Events", "Lincoln Park Bistro", "Riverwalk Catering Co."],
  atl: ["Peachtree Catering Co.", "Magnolia Hall Events", "Midtown Grill House", "Southern Table Kitchen", "Piedmont Park Hotel"],
  dal: ["Lone Star Banquets", "Trinity River Grill", "Uptown Hotel Dallas", "Deep Ellum Kitchen", "Bluebonnet Catering"],
}

const SETTINGS: Record<PositionCategory, string[]> = {
  "Front of house": ["stadiums and arenas", "hotel banquets", "busy restaurants", "concert venues", "corporate catering"],
  "Back of house": ["high-volume kitchens", "hotel kitchens", "campus dining", "catering kitchens"],
  Events: ["conventions and festivals", "event venues", "stadium operations"],
}

const SKILLS: Record<string, string[]> = {
  bartender: ["Craft cocktails", "High-volume bar", "ID checks"],
  barback: ["Bar restocking", "Keg changes", "Glassware"],
  server: ["Plated service", "Banquet setup", "Wine service"],
  concessions: ["Cash handling", "Stand setup", "Fast service"],
  cashier: ["Cash handling", "POS systems", "Guest service"],
  suite: ["VIP service", "Suite setup", "Order tracking"],
  linecook: ["Line cooking", "Ticket times", "Knife skills"],
  prepcook: ["Knife skills", "Batch prep", "Labeling and dating"],
  dishwasher: ["Dish machine", "Sanitation", "Pot washing"],
  porter: ["Event setup", "Room flips", "Safe lifting"],
}

const EXTRA_SKILLS = ["Bilingual English and Spanish", "Trains new hires", "Opening and closing", "Allergen awareness"]

const STATE_NAME: Record<string, string> = { chi: "Illinois", atl: "Georgia", dal: "Texas" }

const ALCOHOL_CERT: Record<string, string> = { chi: "BASSET", atl: "TIPS", dal: "TABC" }

const CERTIFICATIONS: Partial<Record<RequirementId, (cityId: string) => string>> = {
  orientation: () => "Compass orientation",
  foodHandler: (cityId) => `${STATE_NAME[cityId] ?? "State"} food handler card`,
  alcohol: (cityId) => `${ALCOHOL_CERT[cityId] ?? "TIPS"} alcohol certification`,
}

const RECRUITERS: Record<string, string[]> = {
  instawork: ["Tasha Green", "Ben Morales"],
  crewline: ["Kevin Shah", "Mia Lopez"],
  harbor: ["Owen Hart", "Lena Cho"],
  metro: ["Jada Simmons", "Marco Ruiz"],
}

const NOTES = {
  screen: [
    "Clear communicator. Confirmed nights and weekends.",
    "Walked through recent event work. Good fit for high-volume shifts.",
    "Flexible schedule and reliable transportation.",
  ],
  screenFollowUp: ["Good energy. Asked for one more reference.", "Needs to confirm transportation for late shifts."],
  inPerson: [
    "Arrived early and in uniform. Strong {role} fundamentals.",
    "Ran a mock service. Calm, quick and friendly with guests.",
    "Great attitude. Ready for {role} shifts at large venues.",
  ],
}

/**
 * Resumes, interviews and offers aren't in the data model yet, so they're derived from the Pro's id and read the same
 * on every visit. Certifications follow the completed documents, and the first offer stays pending until onboarding ends.
 */
export function proProfile(pro: Pro, rateCards: RateCard[], today = todayISO()): ProProfile {
  const r = createRandom(hashString(pro.id))
  const primary = position(pro.positionIds[0])
  const roles = pro.positionIds.map((id) => position(id).name)

  const months = r.int(1, 9) * 12 + r.int(0, 11)
  const setting = r.pick(SETTINGS[primary.category])
  const employers = r.shuffle(EMPLOYERS[pro.cityId] ?? EMPLOYERS.chi).slice(0, months >= 30 ? r.int(2, 3) : 2)
  const stillThere = r.chance(0.35)
  const weights = employers.map(() => r.float(0.6, 1.4))
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const jobs: ResumeJob[] = []
  let end = subMonths(parseDate(pro.joinedOn), r.int(0, 2))
  employers.forEach((employer, i) => {
    const start = subMonths(end, Math.max(6, Math.round((weights[i] / totalWeight) * months)))
    jobs.push({ employer, role: roles[i % roles.length], from: toISODate(start), to: i === 0 && stillThere ? undefined : toISODate(end) })
    end = subMonths(start, r.int(0, 3))
  })
  const firstJob = jobs[jobs.length - 1]?.from ?? pro.joinedOn
  const years = Math.max(1, Math.floor(differenceInCalendarDays(parseDate(today), parseDate(firstJob)) / 365))

  const [main, ...others] = pro.positionIds
  const mainSkills = r.shuffle(SKILLS[main] ?? []).slice(0, 2)
  const otherSkills = [...new Set(others.flatMap((id) => SKILLS[id] ?? []))].filter((s) => !mainSkills.includes(s))
  const skills = [...mainSkills, ...r.shuffle(otherSkills).slice(0, r.int(1, 2))]
  if (r.chance(0.4)) skills.push(r.pick(EXTRA_SKILLS))

  const certifications = requirementRows(pro).flatMap((row) => {
    const name = CERTIFICATIONS[row.id]?.(pro.cityId)
    return name && (row.state === "complete" || row.state === "expiring") ? [name] : []
  })

  const lead = supplier(pro.supplierId).contactName
  const team = RECRUITERS[pro.supplierId] ?? [lead]
  const recruiter = r.pick(team)
  const lastInterview = addDaysISO(pro.joinedOn, -r.int(5, 12))
  const twoRounds = r.chance(0.5)
  const phoneOnly = r.chance(0.5)
  const followUp = twoRounds && r.chance(0.3)
  const screen: ProInterview = {
    id: `${pro.id}-screen`,
    date: twoRounds ? addDaysISO(lastInterview, -r.int(2, 6)) : lastInterview,
    interviewer: recruiter,
    mode: "phone",
    outcome: followUp ? "follow_up" : "passed",
    note: r.pick(followUp ? NOTES.screenFollowUp : NOTES.screen),
  }
  const inPerson: ProInterview = {
    id: `${pro.id}-in-person`,
    date: lastInterview,
    interviewer: lead,
    mode: "in_person",
    outcome: "passed",
    note: r.pick(NOTES.inPerson).replace("{role}", primary.name.toLowerCase()),
  }
  const interviews = twoRounds ? [inPerson, screen] : [phoneOnly ? screen : inPerson]

  const payFor = (positionId: string) =>
    rateCards.find((c) => c.supplierId === pro.supplierId && c.cityId === pro.cityId && c.positionId === positionId && c.status === "active")?.proRate ??
    roundTo(position(positionId).basePay * city(pro.cityId).payIndex * supplier(pro.supplierId).profile.payIndex, 0.25)
  const offerDate = addDaysISO(lastInterview, r.int(1, 3))
  const declinable = POSITIONS.filter((p) => p.category === primary.category && !pro.positionIds.includes(p.id))
  const declined = declinable.length > 0 && r.chance(0.35) ? r.pick(declinable) : undefined
  const added = pro.positionIds[1]
  const addedOffered = !!added && r.chance(0.5)
  const addedDate = addDaysISO(pro.joinedOn, r.int(20, 420))
  const offers: ProOffer[] = [
    {
      id: `${pro.id}-offer-1`,
      positionId: primary.id,
      payRate: payFor(primary.id),
      date: declined ? addDaysISO(offerDate, 2) : offerDate,
      status: pro.status === "onboarding" ? "pending" : "accepted",
    },
  ]
  if (declined) offers.push({ id: `${pro.id}-offer-0`, positionId: declined.id, payRate: payFor(declined.id), date: offerDate, status: "declined" })
  if (addedOffered && addedDate < today) offers.push({ id: `${pro.id}-offer-2`, positionId: added, payRate: payFor(added), date: addedDate, status: "accepted" })
  offers.sort((a, b) => b.date.localeCompare(a.date))

  return {
    resume: { headline: `${primary.name} with ${plural(years, "year")} in ${setting}`, years, jobs, skills, certifications },
    interviews,
    offers,
  }
}

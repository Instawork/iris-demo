"use client"

import { Briefcase, CheckCircle2, CircleDashed, Clock3, Loader2, Phone, ShieldCheck, Star, UsersRound, XCircle, type LucideIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { InfoTip, Tip } from "@/components/common/info-tip"
import { StatusBadge, toneText, type Tone } from "@/components/common/status-badge"
import { Stars } from "@/components/pros/pro-status"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/hooks/use-app"
import { requirementRows, type RequirementRow } from "@/lib/compliance"
import { dateOf, daysFromToday, formatDateFull, formatDay, todayISO } from "@/lib/dates"
import { plural, rate } from "@/lib/format"
import { standingOf, type ProInterview, type ProOffer, type ProResume } from "@/lib/pro-profile"
import { REQUIREMENTS, buyer, cityLabel, location, position, supplier } from "@/lib/reference"
import { CHECKS, readDocument } from "@/lib/verification"
import { useStore } from "@/lib/store"
import type { ComplianceState, Pro, ProReview, RequirementId } from "@/lib/types"
import { cn } from "@/lib/utils"

function Block({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-caption-1 font-medium text-faded">
        {title}
        {info && <InfoTip>{info}</InfoTip>}
      </h4>
      {children}
    </section>
  )
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tint-faded ring-1 ring-border ring-inset">
      <Icon className="size-4 text-faded" />
    </span>
  )
}

const monthYear = (iso: string) => formatDay(iso, "MMM yyyy")

/* --------------------------------- Resume ---------------------------------- */

export function ResumeSection({ pro, resume }: { pro: Pro; resume: ProResume }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <p className="text-body-2 font-semibold">{resume.headline}</p>
        <p className="text-caption-1 text-faded">
          {cityLabel(pro.cityId)} · With {supplier(pro.supplierId).shortName} since {monthYear(pro.joinedOn)}
        </p>
      </div>
      <Block title="Positions" info="Positions this worker is approved to work on Iris.">
        <div className="flex flex-wrap gap-1.5">
          {pro.positionIds.map((id) => (
            <StatusBadge key={id} tone="primary">
              {position(id).name}
            </StatusBadge>
          ))}
        </div>
      </Block>
      <Block title="Experience">
        <ul className="flex flex-col gap-3">
          {resume.jobs.map((j) => (
            <li key={`${j.employer}-${j.from}`} className="flex items-center gap-3">
              <IconTile icon={Briefcase} />
              <span className="flex min-w-0 flex-col">
                <span className="text-body-3 font-semibold">{j.role}</span>
                <span className="text-caption-1 text-faded">
                  {j.employer} · {monthYear(j.from)} – {j.to ? monthYear(j.to) : "Present"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Skills">
        <div className="flex flex-wrap gap-1.5">
          {resume.skills.map((s) => (
            <StatusBadge key={s}>{s}</StatusBadge>
          ))}
        </div>
      </Block>
      <Block title="Certifications" info="Taken from the documents the agency has verified.">
        {resume.certifications.length ? (
          <div className="flex flex-wrap gap-1.5">
            {resume.certifications.map((c) => (
              <StatusBadge key={c} tone="positive">
                <ShieldCheck className="size-3.5" />
                {c}
              </StatusBadge>
            ))}
          </div>
        ) : (
          <p className="text-body-3 text-faded">None verified yet.</p>
        )}
      </Block>
    </div>
  )
}

/* ------------------------------- Interviews -------------------------------- */

export function InterviewsSection({ interviews }: { interviews: ProInterview[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {interviews.map((i) => (
        <li key={i.id} className="flex items-start gap-3 px-3 py-3">
          <IconTile icon={i.mode === "phone" ? Phone : UsersRound} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center justify-between gap-2">
              <span className="text-body-3 font-semibold">{i.mode === "phone" ? "Phone screen" : "In-person interview"}</span>
              <StatusBadge size="sm" tone={i.outcome === "passed" ? "positive" : "warning"}>
                {i.outcome === "passed" ? "Passed" : "Needs follow-up"}
              </StatusBadge>
            </span>
            <span className="text-caption-1 text-faded">
              {formatDateFull(i.date)} · with {i.interviewer}
            </span>
            <span className="pt-1 text-body-3">{i.note}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/* --------------------------------- Offers ---------------------------------- */

const OFFER_STATUS: Record<ProOffer["status"], { label: string; tone: Tone; tip?: string }> = {
  accepted: { label: "Accepted", tone: "positive" },
  declined: { label: "Declined", tone: "neutral" },
  pending: { label: "Pending", tone: "warning", tip: "Final once onboarding is complete." },
}

export function OffersSection({ offers }: { offers: ProOffer[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {offers.map((o) => {
        const s = OFFER_STATUS[o.status]
        return (
          <li key={o.id} className="flex items-center gap-3 px-3 py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-3 font-semibold">{position(o.positionId).name}</span>
              <span className="text-caption-1 text-faded">Offered {formatDateFull(o.date)}</span>
            </span>
            <span className="text-body-3 font-semibold tabular">{rate(o.payRate)}</span>
            <Tip content={s.tip}>
              <span className="inline-flex w-18 justify-end">
                <StatusBadge size="sm" tone={s.tone}>
                  {s.label}
                </StatusBadge>
              </span>
            </Tip>
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------- Documents -------------------------------- */

const DOC_STATE: Record<Exclude<ComplianceState, "not_required">, { label: string; tone: Tone; icon: LucideIcon }> = {
  complete: { label: "Complete", tone: "positive", icon: CheckCircle2 },
  expiring: { label: "Expiring", tone: "warning", icon: Clock3 },
  expired: { label: "Expired", tone: "critical", icon: XCircle },
  pending: { label: "Pending", tone: "warning", icon: CircleDashed },
  missing: { label: "Missing", tone: "critical", icon: XCircle },
}

function docDetail(row: RequirementRow) {
  const { completedOn, expiresOn, verification: v } = row.item ?? {}
  if (v?.result === "rejected") return `Sent back by ${v.reviewedBy}: ${v.reviewNote ?? "needs a new document"}`
  if (row.state === "missing") return "Not received yet"
  if (row.state === "pending") return v?.result === "needs_review" ? `Iris couldn't verify it: ${v.reason}. Waiting on Compass compliance.` : "Submitted, waiting on results"
  if (row.state === "expired") return expiresOn ? `Expired ${formatDateFull(expiresOn)}` : "Expired"
  if (row.state === "expiring" && expiresOn) return `Expires ${formatDateFull(expiresOn)} · in ${plural(daysFromToday(expiresOn), "day")}`
  return [completedOn && `Completed ${formatDateFull(completedOn)}`, expiresOn && `expires ${formatDateFull(expiresOn)}`].filter(Boolean).join(" · ")
}

/** Who confirmed a document and how, for anyone checking a Pro's file. */
function proofLine(row: RequirementRow) {
  const v = row.item?.verification
  if (!v || v.result !== "verified") return undefined
  if (CHECKS[row.id].attested) return `Attested by ${v.attestedBy} · ${formatDateFull(dateOf(v.at))}`
  return `${v.reviewedBy ? `Accepted by ${v.reviewedBy}` : `Verified with ${v.checkedWith}`} · ${v.reference} · asked by ${v.attestedBy}`
}

export function DocumentsSection({ pro, canComplete }: { pro: Pro; canComplete: boolean }) {
  const { ws } = useWorkspace()
  const reviewDocument = useStore((s) => s.reviewDocument)
  const verifyRequirement = useStore((s) => s.verifyRequirement)
  const [checking, setChecking] = useState<RequirementId>()
  const [sending, setSending] = useState<RequirementId>()
  const [note, setNote] = useState("")
  const rows = requirementRows(pro).filter((r) => r.state !== "not_required")
  const done = rows.filter((r) => r.state === "complete" || r.state === "expiring").length
  const reviewer = ws.kind === "compass"

  const finish = (requirement: RequirementId, wasBlocked: boolean, how = "verified") => {
    const next = useStore.getState().data.pros.find((p) => p.id === pro.id)
    const row = next && requirementRows(next).find((r) => r.id === requirement)
    if (!next || !row || row.item?.status !== "complete") return
    const cleared = standingOf(next) === "compliant"
    if (pro.status === "onboarding" && cleared) toast.success(`${pro.firstName} finished onboarding`, { description: "Buyers and Compass now see them as compliant." })
    else if (wasBlocked && cleared) toast.success(`${pro.firstName} is cleared to work again`, { description: `${row.label} ${how}.` })
  }

  /** One click: Iris asks the issuer, or records the agency's attestation, and the row turns green where it is. */
  const clear = async (requirement: RequirementId) => {
    const found = readDocument(requirement, pro.id, todayISO())
    setChecking(requirement)
    try {
      await Promise.all([
        verifyRequirement(pro.id, requirement, { provider: found.provider, reference: found.reference, issuedOn: found.issuedOn, expiresOn: found.expiresOn }),
        new Promise((resolve) => setTimeout(resolve, CHECKS[requirement].attested ? 400 : 1100)),
      ])
    } finally {
      setChecking(undefined)
    }
  }

  const decide = async (requirement: RequirementId, decision: "accept" | "reject") => {
    const wasBlocked = standingOf(pro) === "not_compliant"
    if (!(await reviewDocument(pro.id, requirement, decision, decision === "reject" ? note.trim() : undefined))) return
    setSending(undefined)
    setNote("")
    if (decision === "accept") finish(requirement, wasBlocked, "accepted")
    else toast.success(`Sent back to ${supplier(pro.supplierId).shortName}`)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-caption-1 text-faded">
        {done} of {rows.length} complete
        <InfoTip>Only the documents this worker&apos;s positions need. Compass requires every one before a shift.</InfoTip>
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => {
          const meta = DOC_STATE[row.state as keyof typeof DOC_STATE]
          const Icon = meta.icon
          const actionable = canComplete && row.state !== "complete"
          const held = row.item?.verification?.result === "needs_review" && row.state === "pending"
          const issuer = CHECKS[row.id].attested ? undefined : readDocument(row.id, pro.id, todayISO()).provider
          const proof = proofLine(row)
          return (
            <li key={row.id} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Icon className={cn("size-4 shrink-0", toneText[meta.tone])} />
                <Tip content={REQUIREMENTS.find((x) => x.id === row.id)?.description}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-3 font-semibold">{row.label}</span>
                    <span className="text-caption-1 text-faded">{docDetail(row)}</span>
                    {proof && (
                      <span className="flex items-center gap-1 text-caption-1 text-positive-fg">
                        <ShieldCheck className="size-3" /> {proof}
                      </span>
                    )}
                  </span>
                </Tip>
                {reviewer && held ? (
                  <span className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 rounded-md text-caption-1" onClick={() => setSending(sending === row.id ? undefined : row.id)}>
                      Send back
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 rounded-md text-caption-1" onClick={() => decide(row.id, "accept")} data-tour="doc-accept">
                      Accept
                    </Button>
                  </span>
                ) : actionable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 rounded-md text-caption-1"
                    disabled={!!checking}
                    onClick={() => void clear(row.id)}
                    data-tour="doc-action"
                    data-doc-state={row.state}
                    data-doc-id={row.id}
                  >
                    {checking === row.id ? (
                      <>
                        <Loader2 className="size-3 animate-spin" /> {issuer ? `Checking with ${issuer}` : "Attesting"}
                      </>
                    ) : issuer ? (
                      `Verify with ${issuer}`
                    ) : (
                      "Attest"
                    )}
                  </Button>
                ) : (
                  <StatusBadge size="sm" tone={meta.tone}>
                    {meta.label}
                  </StatusBadge>
                )}
              </div>
              {sending === row.id && (
                <div className="flex gap-2 pl-7">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={`What ${supplier(pro.supplierId).shortName} needs to fix`}
                    autoFocus
                    className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-body-3 outline-none focus:border-foreground/30"
                  />
                  <Button size="sm" className="h-8" disabled={!note.trim()} onClick={() => decide(row.id, "reject")}>
                    Send
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* --------------------------------- Reviews --------------------------------- */

function ReviewItem({ review, showBuyer }: { review: ProReview; showBuyer: boolean }) {
  const group = useStore((s) => (review.groupId ? s.data.groups.find((g) => g.id === review.groupId) : undefined))
  const context = [review.by, showBuyer && buyer(review.buyerId).name, group && `${position(group.positionId).name} at ${location(group.locationId).name}`]
    .filter(Boolean)
    .join(" · ")
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <span className="flex items-center justify-between gap-2">
        <Stars value={review.rating} />
        <span className="text-caption-1 text-subtle">{formatDateFull(review.at)}</span>
      </span>
      {review.text && <p className="text-body-3">{review.text}</p>}
      <p className="text-caption-1 text-faded">{context}</p>
    </li>
  )
}

function ReviewForm({ pro, buyerId, onDone }: { pro: Pro; buyerId: string; onDone: () => void }) {
  const addReview = useStore((s) => s.addReview)
  const groupId = useStore(
    (s) =>
      s.data.timesheets
        .filter((t) => t.proId === pro.id && t.buyerId === buyerId)
        .reduce<{ date: string; groupId?: string }>((latest, t) => (t.date > latest.date ? { date: t.date, groupId: t.groupId } : latest), { date: "" }).groupId,
  )
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [text, setText] = useState("")
  const shown = hover || rating

  const submit = () => {
    addReview({ proId: pro.id, buyerId, groupId, rating, text: text.trim() })
    toast.success(`You rated ${pro.firstName} ${rating} of 5`, { description: `${supplier(pro.supplierId).shortName} and Compass can see your review.` })
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-tint-faded p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-3 font-semibold">Rate {pro.firstName}</span>
        <span role="radiogroup" aria-label="Rating" className="flex items-center" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={plural(n, "star")}
              onMouseEnter={() => setHover(n)}
              onClick={() => setRating(n)}
              className="rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Star className={cn("size-6 transition-colors duration-100", n <= shown ? "fill-warning text-warning" : "text-border-strong")} />
            </button>
          ))}
        </span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What went well? What could be better?"
        className="min-h-20 bg-card text-body-3"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" className="h-8 rounded-lg" disabled={!rating} onClick={submit}>
          Submit review
        </Button>
      </div>
    </div>
  )
}

export function ReviewsSection({
  pro,
  reviews,
  buyerId,
  composing,
  canReview,
  onComposingChange,
}: {
  pro: Pro
  reviews: ProReview[]
  buyerId?: string
  composing: boolean
  canReview: boolean
  onComposingChange: (composing: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
        <span className="text-featured-2 font-semibold tabular">{pro.rating ? pro.rating.toFixed(1) : "--"}</span>
        <span className="flex flex-1 flex-col gap-0.5">
          <Stars value={Math.round(pro.rating)} />
          <span className="text-caption-1 text-faded">
            {reviews.length ? plural(reviews.length, "review") : "No reviews yet"}
            {buyerId && reviews.length > 0 && " from your team"}
          </span>
        </span>
        <InfoTip>Average of every buyer&apos;s ratings after a shift. Agencies and Compass see each rating.</InfoTip>
      </div>
      {composing && buyerId && canReview && <ReviewForm pro={pro} buyerId={buyerId} onDone={() => onComposingChange(false)} />}
      {reviews.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {reviews.map((r) => (
            <ReviewItem key={r.id} review={r} showBuyer={!buyerId} />
          ))}
        </ul>
      ) : (
        buyerId &&
        !canReview && <p className="text-body-3 text-faded">You can rate {pro.firstName} after they work a shift at your locations.</p>
      )}
    </div>
  )
}

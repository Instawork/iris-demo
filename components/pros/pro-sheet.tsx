"use client"

import { Ban, Heart, Star, ThumbsUp, type LucideIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { Tip } from "@/components/common/info-tip"
import { PillTabs } from "@/components/common/pill-tabs"
import { ProAvatar } from "@/components/common/pro-avatar"
import { DocumentsSection, InterviewsSection, OffersSection, ResumeSection, ReviewsSection } from "@/components/pros/pro-sections"
import { ComplianceBadge, OnboardingLabel, Rating } from "@/components/pros/pro-status"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useData, useWorkspace } from "@/hooks/use-app"
import { fullName, plural } from "@/lib/format"
import { proStats } from "@/lib/metrics"
import { complianceOf, onboardingOf, proProfile } from "@/lib/pro-profile"
import { supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { PersonaKind, Pro, RosterStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

type Section = "resume" | "interviews" | "offers" | "documents" | "reviews"

const SECTIONS: { value: Section; label: string; kinds: PersonaKind[] }[] = [
  { value: "resume", label: "Resume", kinds: ["supplier", "buyer", "compass"] },
  { value: "interviews", label: "Interviews", kinds: ["supplier", "compass"] },
  { value: "offers", label: "Offers", kinds: ["supplier", "compass"] },
  { value: "documents", label: "Documents", kinds: ["supplier", "buyer", "compass"] },
  { value: "reviews", label: "Reviews", kinds: ["supplier", "buyer", "compass"] },
]

const ROSTER: { value: RosterStatus; label: string; active: string; icon: LucideIcon; tone: string; added: string; removed: string; hint?: string }[] = [
  {
    value: "favorite",
    label: "Favorite",
    active: "Favorite",
    icon: Heart,
    tone: "text-foreground",
    added: "added to your Favorites",
    removed: "removed from your Favorites",
    hint: "They see your shifts before anyone else.",
  },
  {
    value: "ok_to_return",
    label: "Ok to return",
    active: "Ok to return",
    icon: ThumbsUp,
    tone: "text-positive-fg",
    added: "marked Ok to return",
    removed: "removed from Ok to return",
  },
  {
    value: "blocked",
    label: "Block",
    active: "Blocked",
    icon: Ban,
    tone: "text-critical-fg",
    added: "blocked",
    removed: "unblocked",
    hint: "They can't book your shifts with any supplier.",
  },
]

/** A Pro's profile. Pass `open` to keep the last Pro on screen while the sheet animates closed. */
export function ProSheet({ proId, open, onOpenChange }: { proId?: string; open?: boolean; onOpenChange: (open: boolean) => void }) {
  const pro = useStore((s) => (proId ? s.data.pros.find((p) => p.id === proId) : undefined))
  return (
    <Sheet open={!!pro && (open ?? true)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {pro && <ProfileBody key={pro.id} pro={pro} />}
      </SheetContent>
    </Sheet>
  )
}

function ProfileBody({ pro }: { pro: Pro }) {
  const data = useData()
  const { ws } = useWorkspace()
  const buyerId = ws.kind === "buyer" ? ws.buyerId : undefined
  const compliance = complianceOf(pro)
  const onboarding = onboardingOf(pro)
  const shifts = buyerId ? proStats(data, `${pro.id}|${buyerId}`).shifts : pro.shiftsWorked
  const canReview = !!buyerId && shifts > 0
  const profile = useMemo(() => proProfile(pro, data.rateCards), [pro, data.rateCards])
  const reviews = useMemo(
    () => data.reviews.filter((r) => r.proId === pro.id && (!buyerId || r.buyerId === buyerId)).sort((a, b) => b.at.localeCompare(a.at)),
    [data.reviews, pro.id, buyerId],
  )
  const sections = SECTIONS.filter((s) => s.kinds.includes(ws.kind))
  const [section, setSection] = useState<Section>(() => (compliance.issues.length ? "documents" : "resume"))
  const [composing, setComposing] = useState(false)

  return (
    <>
      <SheetHeader className="gap-4 border-b border-border px-6 pt-6 pb-5">
        <div className="flex items-start gap-4 pr-8">
          <ProAvatar pro={pro} size="xl" ring />
          <div className="flex min-w-0 flex-col gap-1.5">
            <SheetTitle className="text-featured-3 font-bold">{fullName(pro)}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-1.5 text-body-3 text-faded">
              <SupplierLogo supplierId={pro.supplierId} size="xs" />
              <span>{supplier(pro.supplierId).shortName}</span>
              <span className="text-subtle">·</span>
              <Tip content="CrUber ID. Use it in timesheet, tip and invoice uploads.">
                <code className="rounded-md bg-tint-faded px-1.5 py-0.5 font-mono text-caption-1">{pro.code}</code>
              </Tip>
            </SheetDescription>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-3">
              <Rating value={pro.rating} empty="No rating yet" className="font-semibold" />
              <span className="text-faded tabular">
                {plural(shifts, "shift")}
                {buyerId && " with you"}
              </span>
              <ComplianceBadge status={compliance} />
              {!onboarding.complete && <OnboardingLabel status={onboarding} />}
            </div>
          </div>
        </div>
        {buyerId && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RosterControls pro={pro} buyerId={buyerId} />
            {canReview && (
              <Button
                variant="outline"
                className="h-8 gap-1.5 rounded-lg text-caption-1"
                onClick={() => {
                  setSection("reviews")
                  setComposing(true)
                }}
              >
                <Star className="size-3.5" /> Rate & review
              </Button>
            )}
          </div>
        )}
      </SheetHeader>

      <div className="flex flex-col gap-5 px-6 py-5">
        <PillTabs
          size="sm"
          value={section}
          onChange={setSection}
          className="max-w-full overflow-x-auto scrollbar-none"
          items={sections.map((s) => ({ value: s.value, label: s.label, count: s.value === "reviews" ? reviews.length : undefined }))}
        />
        {section === "resume" && <ResumeSection pro={pro} resume={profile.resume} />}
        {section === "interviews" && <InterviewsSection interviews={profile.interviews} />}
        {section === "offers" && <OffersSection offers={profile.offers} />}
        {section === "documents" && <DocumentsSection pro={pro} canComplete={ws.kind === "supplier" && ws.supplierId === pro.supplierId} />}
        {section === "reviews" && (
          <ReviewsSection pro={pro} reviews={reviews} buyerId={buyerId} composing={composing} canReview={canReview} onComposingChange={setComposing} />
        )}
      </div>
    </>
  )
}

function RosterControls({ pro, buyerId }: { pro: Pro; buyerId: string }) {
  const status = useStore((s) => s.data.roster.find((r) => r.buyerId === buyerId && r.proId === pro.id)?.status)
  const setRoster = useStore((s) => s.setRoster)
  return (
    <div role="group" aria-label="Your roster" className="inline-flex items-center gap-0.5 rounded-lg bg-foreground/[0.045] p-0.5">
      {ROSTER.map((o) => {
        const on = status === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setRoster(buyerId, [pro.id], on ? null : o.value)
              if (on) toast(`${pro.firstName} ${o.removed}`)
              else toast.success(`${pro.firstName} ${o.added}`, { description: o.hint })
            }}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-caption-1 font-medium whitespace-nowrap transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              on ? "bg-background text-foreground shadow-raised" : "text-faded hover:text-foreground",
            )}
          >
            <o.icon className={cn("size-3.5", on && o.tone)} fill={on && o.value === "favorite" ? "currentColor" : "none"} />
            {on ? o.active : o.label}
          </button>
        )
      })}
    </div>
  )
}

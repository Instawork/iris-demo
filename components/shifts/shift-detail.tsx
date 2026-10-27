"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Ban,
  CalendarX2,
  Coins,
  Copy,
  Download,
  Heart,
  Mail,
  MoreHorizontal,
  Repeat,
  Star,
  UserMinus,
  UserPlus,
  Users,
  UserX,
} from "lucide-react"
import { motion } from "motion/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { FillPipe } from "@/components/common/fill-pipe"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { ProSheet } from "@/components/pros/pro-sheet"
import { AssignProsDialog } from "@/components/shifts/assign-pros-dialog"
import { ApprovalCard, ReleaseCard } from "@/components/shifts/order-status"
import { TimesheetStatusBadge } from "@/components/timesheets/timesheet-bits"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatClock, formatDateLong, formatInterval, formatTimestamp, timeAgo } from "@/lib/dates"
import { fullName, money, plural, round2 } from "@/lib/format"
import { filledCount, fillRatio, fillTone, formatTimeToFill, groupEstimate, groupHours, groupInScope, groupPhase } from "@/lib/metrics"
import { buyer, city, location, position, supplier } from "@/lib/reference"
import { joinNames, notifiedSuppliers, useStore } from "@/lib/store"
import type { Pro, ShiftGroup, Timesheet } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ShiftDetail({ id }: { id: string }) {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const group = data.groups.find((g) => g.id === id)
  if (!group || !groupInScope(scope, group)) {
    return (
      <div className="pt-10">
        <EmptyState
          icon={CalendarX2}
          title="Shift not found"
          description={group ? `This shift belongs to another ${ws.kind === "supplier" ? "supplier" : "buyer"}. Switch workspaces to see it.` : "It may have been removed or the link is wrong."}
          actions={
            <Button asChild variant="outline">
              <Link href="/shifts">Back to Shifts</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return <ShiftDetailBody group={group} />
}

function ShiftDetailBody({ group }: { group: ShiftGroup }) {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const { cancelGroup, setHeadcount, releasePro, markNoShow, setRoster, setTips } = useStore.getState()
  const [proId, setProId] = useState<string>()
  const [assignOpen, setAssignOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [headcountOpen, setHeadcountOpen] = useState(false)
  const [tipsOpen, setTipsOpen] = useState(false)

  const pos = position(group.positionId)
  const loc = location(group.locationId)
  const sent = joinNames(group.supplierIds.map((id) => supplier(id).shortName))
  const supplierReleases =
    group.supplierReleases ??
    (group.approval && group.approval.status !== "approved"
      ? notifiedSuppliers(data, group.buyerId, loc.cityId, group.positionId).map((n) => ({ supplierId: n.card.supplierId, releasedAt: "" }))
      : group.supplierIds.map((supplierId) => ({ supplierId, releasedAt: group.createdAt })))
  const phase = groupPhase(group)
  const filled = filledCount(group)
  const total = group.slots.length
  const isBuyer = ws.kind === "buyer"
  const isSupplier = ws.kind === "supplier"
  const upcoming = phase === "upcoming" && !group.cancelledAt

  const rows = useMemo(
    () =>
      group.slots.map((slot) => ({
        slot,
        pro: slot.proId ? data.pros.find((p) => p.id === slot.proId && (ws.kind !== "supplier" || p.supplierId === ws.supplierId)) : undefined,
        otherSupplier: ws.kind === "supplier" && slot.proId ? data.pros.find((p) => p.id === slot.proId && p.supplierId !== ws.supplierId)?.supplierId : undefined,
        ts: slot.proId ? data.timesheets.find((t) => t.groupId === group.id && t.proId === slot.proId) : undefined,
        roster: slot.proId && ws.buyerId ? data.roster.find((r) => r.buyerId === ws.buyerId && r.proId === slot.proId) : undefined,
      })),
    [group, data.pros, data.timesheets, data.roster, ws.buyerId, ws.kind, ws.supplierId],
  )

  const activity = useMemo(
    () => buildTimeline(group, data.pros, data.timesheets, data.invoices.filter((i) => i.status !== "open").map((i) => ({ id: i.id, number: i.number, issuedOn: i.issuedOn }))),
    [group, data.pros, data.timesheets, data.invoices],
  )

  const exportRoster = () => {
    downloadCsv(
      exportName(`timesheet-${group.code}`),
      toCsv(
        rows.map(({ slot, pro, ts }) => ({
          shift_group_id: group.code,
          pro_id: pro?.code ?? "",
          pro_name: pro ? fullName(pro) : "Open spot",
          date: group.date,
          scheduled_start: group.start,
          scheduled_end: group.end,
          clock_in: ts?.clockIn ?? "",
          clock_out: ts?.clockOut ?? "",
          break_minutes: ts?.breakMins ?? group.breakMins,
          hours: ts?.hours ?? "",
          tips: ts?.tips ?? "",
          status: slot.status,
        })),
      ),
    )
  }

  const tz = city(loc.cityId).tz
  const hasTips = group.badges.includes("TIPS") || rows.some((r) => (r.ts?.tips ?? 0) > 0)
  const timed = rows.some((r) => r.ts)
  const staffed = rows.filter((r) => r.pro)
  const openSpots = rows.filter((r) => !r.pro && !r.otherSupplier).length
  const elsewhere = [...rows.reduce((m, r) => (!r.pro && r.otherSupplier ? m.set(r.otherSupplier, (m.get(r.otherSupplier) ?? 0) + 1) : m), new Map<string, number>())]
  const lead = timed ? 5 + (hasTips ? 1 : 0) : 1

  return (
    <>
      <div className="flex flex-col gap-4 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-featured-1 font-semibold">{group.name || pos.name}</h1>
            {group.badges.map((b) => (
              <StatusBadge key={b}>{b}</StatusBadge>
            ))}
            {group.approval?.status === "pending" && !group.cancelledAt && <StatusBadge tone="warning">Needs approval</StatusBadge>}
            {group.cancelledAt && <StatusBadge tone="critical">{group.approval?.status === "declined" ? "Declined" : "Cancelled"}</StatusBadge>}
            {phase === "in_progress" && (
              <StatusBadge tone="positive" dot>
                In progress
              </StatusBadge>
            )}
            {group.liveFill && upcoming && group.supplierIds.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-faded px-2.5 py-1 text-caption-1 font-semibold text-primary">
                <span className="size-1.5 animate-live rounded-full bg-primary" /> Suppliers are filling this now
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5 text-body-2 text-faded">
            {group.eventName && <span className="font-medium text-primary">{group.eventName}</span>}
            <span>
              {formatDateLong(group.date)} · {formatInterval(group.start, group.end, tz)} · {ws.kind !== "buyer" && `${buyer(group.buyerId).name}, `}
              {loc.name}
              {group.name && group.name !== pos.name && ` · ${pos.name}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-caption-1 text-subtle">
            <Tip content="Shift group ID. Use it in shift, timesheet and tip CSV uploads.">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(group.code)
                  toast.success(`Copied ${group.code}`)
                }}
                className="inline-flex items-center gap-1 rounded-md bg-tint-faded px-1.5 py-0.5 font-mono text-faded hover:text-foreground"
              >
                {group.code} <Copy className="size-3" />
              </button>
            </Tip>
            <span>
              Posted by {group.createdBy} {timeAgo(group.createdAt)}
              {group.source === "upload" ? " via CSV upload" : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isBuyer && (
            <Button asChild variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3">
              <Link href={`/shifts/new?from=${group.id}`}>
                <Repeat className="size-4" /> Post again
              </Link>
            </Button>
          )}
          {isSupplier && upcoming && filled < total && (
            <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => setAssignOpen(true)} data-tour="assign">
              <UserPlus className="size-4" /> Assign Pros
            </Button>
          )}
          <Button
            variant="outline"
            className="h-9 gap-1.5 rounded-lg text-body-3"
            onClick={() => toast(`Message sent to ${isSupplier ? buyer(group.buyerId).name : sent}`, { description: "In production this opens a shared thread on the shift." })}
          >
            <Mail className="size-4" /> {isSupplier ? "Contact buyer" : group.supplierIds.length > 1 ? "Contact suppliers" : "Contact supplier"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-9 rounded-lg" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {isBuyer && upcoming && (
                <>
                  <DropdownMenuItem onSelect={() => setHeadcountOpen(true)}>
                    <Users /> Change number of Pros
                  </DropdownMenuItem>
                </>
              )}
              {isBuyer && hasTips && phase === "past" && (
                <DropdownMenuItem onSelect={() => setTipsOpen(true)}>
                  <Coins /> Pay tips
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={exportRoster}>
                <Download /> Download timesheet (CSV)
              </DropdownMenuItem>
              {isBuyer && upcoming && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setCancelOpen(true)}>
                    <CalendarX2 /> Cancel shift
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Surface elevated data-tour="roster">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
              <div className="flex items-center gap-3">
                <h3 className="text-body-2 font-bold">{phase === "past" ? "Timesheets" : "Pros"}</h3>
                <span className="inline-flex items-center gap-2 rounded-lg bg-tint-faded px-2 py-1 text-caption-1 font-semibold">
                  <FillPipe ratio={fillRatio(group)} tone={fillTone(group)} className="h-4 w-1.5" />
                  {filled} of {total} filled
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {phase === "past" && ws.kind !== "compass" && (
                  <Button asChild size="sm" className="h-8 rounded-lg text-caption-1 font-semibold" data-tour="hours-action">
                    <Link href={`/timesheets?shift=${group.id}`}>{isBuyer ? "Review hours" : "Submit hours"}</Link>
                  </Button>
                )}
                {isBuyer && hasTips && phase === "past" && (
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg text-caption-1" onClick={() => setTipsOpen(true)}>
                    <Coins className="size-3.5" /> Pay tips
                  </Button>
                )}
                {isBuyer && upcoming && (
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg text-caption-1" onClick={() => setHeadcountOpen(true)}>
                    <UserPlus className="size-3.5" /> Add Pros
                  </Button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto px-2 pt-3 pb-2">
              <table className="w-full text-left text-body-3">
                <thead>
                  <tr className="text-caption-1 font-medium text-faded">
                    <th className="px-3 py-2">Name</th>
                    {timed && (
                      <>
                        <th className="px-3 py-2">Clock-in</th>
                        <th className="px-3 py-2">Clock-out</th>
                        <th className="px-3 py-2">Break (mins)</th>
                        <th className="px-3 py-2 text-right">Hours</th>
                        {hasTips && <th className="px-3 py-2 text-right">Tips</th>}
                      </>
                    )}
                    <th className="px-3 py-2">Status</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {staffed.map(({ slot, pro, ts, roster }) => (
                    <motion.tr
                      key={slot.id}
                      layout="position"
                      transition={{ layout: { duration: 0.2 } }}
                      className="border-t border-border/70 transition-colors duration-100 hover:bg-hover"
                    >
                      <td className="px-3 py-2.5">
                        {pro && (
                          <button type="button" onClick={() => setProId(pro.id)} className="flex items-center gap-2.5 text-left">
                            <ProAvatar pro={pro} size="sm" ring />
                            <span className="flex flex-col whitespace-nowrap">
                              <span className="font-semibold hover:text-primary">
                                {fullName(pro)}
                                {roster?.status === "favorite" && <Heart className="ml-1 inline size-3 fill-critical text-critical" />}
                              </span>
                              <span className="inline-flex items-center gap-1 text-caption-1 text-faded">
                                <Star className="size-3 fill-warning text-warning" /> {pro.rating ? pro.rating.toFixed(2) : "New"} · {isSupplier ? pro.code : supplier(pro.supplierId).shortName}
                              </span>
                            </span>
                          </button>
                        )}
                      </td>
                      {timed && (
                        <>
                          <td className="px-3 py-2.5 tabular">{ts ? formatClock(ts.clockIn) : <span className="text-subtle">--</span>}</td>
                          <td className="px-3 py-2.5 tabular">{ts ? formatClock(ts.clockOut) : <span className="text-subtle">--</span>}</td>
                          <td className="px-3 py-2.5 tabular">{ts ? ts.breakMins : <span className="text-subtle">--</span>}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular">{ts ? ts.hours.toFixed(2) : <span className="font-normal text-subtle">--</span>}</td>
                          {hasTips && <td className="px-3 py-2.5 text-right tabular">{ts?.tips ? money(ts.tips) : <span className="text-subtle">--</span>}</td>}
                        </>
                      )}
                      <td className="px-3 py-2.5">
                        {slot.status === "no_show" ? (
                          <StatusBadge tone="critical">No show</StatusBadge>
                        ) : ts ? (
                          <TimesheetStatusBadge t={ts} kind={ws.kind} />
                        ) : pro ? (
                          <Tip content={slot.confirmedAt ? `Confirmed ${formatTimestamp(slot.confirmedAt)}` : undefined}>
                            <span>
                              <StatusBadge tone={phase === "in_progress" ? "positive" : "primary"} dot>
                                {phase === "in_progress" ? (supplier(pro.supplierId).integration === "api" ? "Clocked in" : "On shift") : "Confirmed"}
                              </StatusBadge>
                            </span>
                          </Tip>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5">
                        {pro && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label="Pro actions">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onSelect={() => setProId(pro.id)}>View profile</DropdownMenuItem>
                              {isBuyer && ws.buyerId && (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setRoster(ws.buyerId!, [pro.id], roster?.status === "favorite" ? null : "favorite")
                                      toast.success(roster?.status === "favorite" ? "Removed from Favorites" : `${pro.firstName} added to Favorites`)
                                    }}
                                  >
                                    <Heart /> {roster?.status === "favorite" ? "Remove from Favorites" : "Add to Favorites"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => {
                                      setRoster(ws.buyerId!, [pro.id], "blocked")
                                      toast(`${pro.firstName} is blocked`, { description: "They can't book your shifts with any supplier." })
                                    }}
                                  >
                                    <Ban /> Block Pro
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(phase === "in_progress" || phase === "past") && slot.status !== "no_show" && !ts?.invoiceId && ws.kind !== "compass" && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    markNoShow(group.id, slot.id)
                                    toast(`${pro.firstName} marked as a no-show`, { description: "No hours will be billed for this spot." })
                                  }}
                                >
                                  <UserX /> Mark as No Show
                                </DropdownMenuItem>
                              )}
                              {isSupplier && upcoming && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    releasePro(group.id, slot.id)
                                    toast(`${pro.firstName} released`, { description: "The spot is open again." })
                                  }}
                                >
                                  <UserMinus /> Release from shift
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                  {elsewhere.map(([id, n]) => (
                    <motion.tr key={`elsewhere-${id}`} layout="position" transition={{ layout: { duration: 0.2 } }} className="border-t border-border/70">
                      <td className="px-3 py-2.5" colSpan={lead}>
                        <span className="flex items-center gap-2.5">
                          <SupplierLogo supplierId={id} size="md" />
                          <span className="font-medium text-faded">
                            {plural(n, "spot")} filled by {supplier(id).shortName}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge tone="neutral">Filled</StatusBadge>
                      </td>
                      <td />
                    </motion.tr>
                  ))}
                  {openSpots > 0 && (
                    <motion.tr key="open" layout="position" transition={{ layout: { duration: 0.2 } }} className="border-t border-border/70">
                      <td className="px-3 py-2.5" colSpan={lead}>
                        <span className="flex items-center gap-2.5">
                          <span className={cn("size-8 rounded-full border border-dashed border-border-strong", group.liveFill && !group.cancelledAt && "skeleton-shimmer border-transparent")} />
                          <span className="flex flex-col whitespace-nowrap">
                            <span className="font-medium text-faded">
                              {group.cancelledAt
                                ? `${plural(openSpots, "spot")} cancelled`
                                : group.liveFill && group.supplierIds.length
                                  ? `Finding ${openSpots === 1 ? "a Pro" : `${openSpots} Pros`}…`
                                  : plural(openSpots, "open spot")}
                            </span>
                            {!group.cancelledAt && (
                              <span className="text-caption-1 text-subtle">{group.approval?.status === "pending" ? "Waiting for approval" : sent ? `Open to ${sent}` : "Held for release"}</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge>{group.cancelledAt ? "Cancelled" : "Open"}</StatusBadge>
                      </td>
                      <td />
                    </motion.tr>
                  )}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface elevated>
            <Accordion type="multiple" defaultValue={["details"]} className="px-5">
              <AccordionItem value="details" className="border-b-0">
                <AccordionTrigger className="text-body-2 font-bold hover:no-underline">Details</AccordionTrigger>
                <AccordionContent>
                  <dl className="grid gap-x-8 gap-y-4 pb-2 sm:grid-cols-2">
                    <Detail label="Job duties">{group.instructions}</Detail>
                    <Detail label="Attire">{group.attire}</Detail>
                    <Detail label="Address">
                      {loc.address} {loc.zip}
                    </Detail>
                    <Detail label="Cost center">
                      <code className="font-mono">{loc.costCenter}</code>
                    </Detail>
                    <Detail label="Paid hours">
                      {groupHours(group)} per Pro, {group.breakMins ? `after a ${group.breakMins} min unpaid break` : "with no unpaid break"}
                    </Detail>
                  </dl>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Surface>
        </div>

        <div className="flex flex-col gap-4">
          <ApprovalCard group={group} />
          <ReleaseCard group={group} />
          <Surface elevated data-tour="release">
            <SurfaceHeader
              title="Suppliers"
              info="Approved suppliers receive this shift in priority order until it fills. Each Pro is billed at their own supplier's rate."
              description={`${group.supplierIds.length} of ${supplierReleases.length} released`}
            />
            <ul className="flex flex-col px-3 pt-2 pb-2">
              {supplierReleases.map(({ supplierId: id, releasedAt }, index) => {
                const s = supplier(id)
                const card = data.rateCards.find((c) => c.supplierId === id && c.cityId === loc.cityId && c.positionId === group.positionId && c.status === "active")
                const filledBy = group.slots.filter((slot) => slot.proId && data.pros.find((p) => p.id === slot.proId)?.supplierId === id).length
                const released = group.supplierIds.includes(id)
                return (
                  <li key={id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular">{index + 1}</span>
                    <SupplierLogo supplierId={id} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-3 font-semibold">{s.shortName}</span>
                      <span className="text-caption-1 text-faded">
                        {released ? (filledBy ? `${filledBy} of ${total} spots filled` : "Released · no Pros yet") : filled >= total ? "Not needed, already full" : releasedAt ? `Scheduled ${formatTimestamp(releasedAt)}` : group.approval?.status === "declined" ? "Not sent" : "After approval"}
                      </span>
                    </span>
                    {card && <span className="text-body-3 font-medium tabular">{money(card.billRate)}/hr</span>}
                  </li>
                )
              })}
            </ul>
            <div className="flex items-end justify-between border-t border-border px-5 py-4">
              <span className="flex items-center gap-1 text-caption-1 text-faded">
                Estimated total <InfoTip>At {supplier(group.supplierId).shortName}&apos;s {money(group.billRate)}/hr bill rate for {total} Pros.</InfoTip>
              </span>
              <span className="text-body-2 font-bold tabular">{money(groupEstimate(group))}</span>
            </div>
          </Surface>

          <Surface elevated>
            <SurfaceHeader title="Activity" />
            <ol className="relative flex flex-col px-5 pt-3 pb-5 before:absolute before:top-5 before:bottom-7 before:left-[25px] before:w-px before:bg-border">
              {activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="relative flex gap-3 py-1.5">
                  <span className={cn("relative z-10 mt-[7px] size-[7px] shrink-0 rounded-full ring-[3px] ring-card", a.dot)} />
                  <span className="flex flex-col">
                    <span className="text-body-3">{a.text}</span>
                    <span className="text-caption-1 text-subtle">{formatTimestamp(a.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Surface>
        </div>
      </div>

      <ProSheet proId={proId} onOpenChange={(o) => !o && setProId(undefined)} />
      {isSupplier && <AssignProsDialog group={group} open={assignOpen} onOpenChange={setAssignOpen} />}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {filled > 0
                ? `${filled} confirmed Pro${filled === 1 ? "" : "s"} will be notified by their suppliers. Cancelling within 24 hours of the start may be billable under the supplier's terms.`
                : `${sent} will stop looking for Pros. Nothing will be billed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep shift</AlertDialogCancel>
            <AlertDialogAction
              className="bg-critical text-white hover:bg-critical/90"
              onClick={() => {
                cancelGroup(group.id)
                toast(`${group.code} cancelled`)
                router.push("/shifts")
              }}
            >
              Cancel shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HeadcountDialog open={headcountOpen} onOpenChange={setHeadcountOpen} group={group} onSave={(n) => setHeadcount(group.id, n)} />
      <TipsDialog open={tipsOpen} onOpenChange={setTipsOpen} rows={rows.filter((r) => r.pro && r.ts).map((r) => ({ pro: r.pro!, ts: r.ts! }))} onSave={setTips} />
    </>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption-1 text-faded">{label}</dt>
      <dd className="text-body-3">{children}</dd>
    </div>
  )
}

export function RateBreakdown({ proRate, billRate, markupPct }: { proRate: number; billRate: number; markupPct: number }) {
  const share = billRate ? proRate / billRate : 0
  return (
    <Tip content={`Pay rate ${money(proRate)}/hr + markup ${money(billRate - proRate)}/hr (${markupPct}%) = ${money(billRate)}/hr bill rate`}>
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
          <motion.span initial={false} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.3 }} className="h-full rounded-full bg-foreground" />
          <span className="h-full flex-1 rounded-full bg-border-strong" />
        </div>
        <div className="flex justify-between text-caption-1 text-faded">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full bg-foreground" />
            Pay rate {money(proRate)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full bg-border-strong" />
            Markup {money(billRate - proRate)}
          </span>
        </div>
      </div>
    </Tip>
  )
}

function HeadcountDialog({ open, onOpenChange, group, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; group: ShiftGroup; onSave: (n: number) => void }) {
  const filled = filledCount(group)
  const [value, setValue] = useState(group.slots.length)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(group.slots.length)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change number of Pros</DialogTitle>
          <DialogDescription>
            {filled} already confirmed. You can add spots or remove open ones. Each spot is {groupHours(group)} paid hours at {money(group.billRate)}/hr.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-4 py-2">
          <Button variant="outline" size="icon" className="size-10 rounded-full text-featured-3" onClick={() => setValue((v) => Math.max(filled || 1, v - 1))}>
            −
          </Button>
          <motion.span key={value} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-16 text-center text-featured-1 font-bold tabular">
            {value}
          </motion.span>
          <Button variant="outline" size="icon" className="size-10 rounded-full text-featured-3" onClick={() => setValue((v) => Math.min(60, v + 1))}>
            +
          </Button>
        </div>
        <p className="text-center text-caption-1 text-faded">New estimate: {money(round2(groupHours(group) * group.billRate * value))}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(value)
              toast.success(`Now ${value} Pros`, { description: value > group.slots.length ? "Your suppliers are filling the new spots." : "Open spots removed." })
              onOpenChange(false)
            }}
            disabled={value === group.slots.length}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TipsDialog({
  open,
  onOpenChange,
  rows,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rows: { pro: Pro; ts: Timesheet }[]
  onSave: (entries: { timesheetId: string; tips: number }[]) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [pool, setPool] = useState("")
  const editable = rows.filter((r) => !r.ts.invoiceId)
  const totalHours = editable.reduce((s, r) => s + r.ts.hours, 0)
  const split = () => {
    const amount = Number(pool)
    if (!amount || !totalHours) return
    setValues(Object.fromEntries(editable.map((r) => [r.ts.id, (Math.round((amount * r.ts.hours) / totalHours * 100) / 100).toFixed(2)])))
  }
  const sum = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValues(Object.fromEntries(rows.map((r) => [r.ts.id, r.ts.tips ? r.ts.tips.toFixed(2) : ""])))
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay tips</DialogTitle>
          <DialogDescription>Tips pass straight through to Pros with no markup. Split a pool by hours, or enter each Pro&apos;s tip.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg bg-page-faded p-3">
          <Coins className="size-4 text-faded" />
          <input
            value={pool}
            onChange={(e) => setPool(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="Tip pool, like 840"
            className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-body-3 outline-none focus:border-primary/60"
          />
          <Button variant="outline" className="h-9 rounded-lg" onClick={split} disabled={!Number(pool)}>
            Split by hours
          </Button>
        </div>
        <div className="max-h-[42svh] overflow-y-auto rounded-lg border border-border scrollbar-thin">
          {rows.map(({ pro, ts }) => (
            <div key={ts.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0">
              <ProAvatar pro={pro} size="xs" />
              <span className="flex-1 text-body-3 font-medium">
                {fullName(pro)} <span className="text-caption-1 text-faded">· {ts.hours} hrs</span>
              </span>
              <span className="text-body-3 text-faded">$</span>
              <input
                disabled={!!ts.invoiceId}
                value={values[ts.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [ts.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                className="h-8 w-24 rounded-md border border-input px-2 text-right text-body-3 tabular outline-none focus:border-primary/60 disabled:bg-tint-faded"
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-body-3 font-semibold">Total {money(sum)}</span>
          <Button
            onClick={() => {
              onSave(Object.entries(values).map(([timesheetId, v]) => ({ timesheetId, tips: Number(v) || 0 })))
              toast.success(`${money(sum)} in tips saved`, { description: "They'll appear on the next invoice." })
              onOpenChange(false)
            }}
          >
            Save tips
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function buildTimeline(group: ShiftGroup, pros: Pro[], timesheets: Timesheet[], invoices: { id: string; number: string; issuedOn: string }[]) {
  const items: { at: string; text: string; dot: string }[] = []
  const a = group.approval
  items.push({
    at: group.createdAt,
    text: a
      ? `${group.createdBy} asked for ${group.slots.length} spots, ${(a.overPct * 100).toFixed(1)}% over the week's budget`
      : group.supplierReleases && !group.supplierIds.length
        ? `${group.createdBy} posted ${group.slots.length} spots, held until ${formatTimestamp(group.supplierReleases[0].releasedAt)}`
        : `${group.createdBy} posted ${group.slots.length} spots${group.supplierIds.length ? ` and notified ${joinNames(group.supplierIds.map((id) => supplier(id).shortName))}` : ""}${group.source === "upload" ? " by CSV upload" : ""}`,
    dot: a ? "bg-warning" : "bg-primary",
  })
  if (a?.decidedAt) items.push({ at: a.decidedAt, text: `${a.decidedBy} ${a.status === "approved" ? "approved" : "declined"} the order${a.note ? `: "${a.note}"` : ""}`, dot: a.status === "approved" ? "bg-positive" : "bg-critical" })
  for (const r of group.supplierReleases ?? []) {
    if (group.supplierIds.includes(r.supplierId) && r.releasedAt > group.createdAt) items.push({ at: r.releasedAt, text: `Released to ${supplier(r.supplierId).shortName}`, dot: "bg-primary" })
  }
  const confirmations = group.slots.filter((s) => s.confirmedAt && s.proId).sort((a, b) => a.confirmedAt!.localeCompare(b.confirmedAt!))
  if (confirmations.length) {
    const first = confirmations[0]
    const last = confirmations[confirmations.length - 1]
    const proName = (id?: string) => {
      const p = pros.find((x) => x.id === id)
      return p ? `${p.firstName} ${p.lastName[0]}.` : "A Pro"
    }
    items.push({ at: first.confirmedAt!, text: `${proName(first.proId)} confirmed first`, dot: "bg-positive" })
    if (confirmations.length > 1) {
      const hrs = (new Date(last.confirmedAt!).getTime() - new Date(group.createdAt).getTime()) / 3600_000
      items.push({ at: last.confirmedAt!, text: `${confirmations.length} of ${group.slots.length} spots confirmed, ${formatTimeToFill(Math.max(0, hrs))} after booking`, dot: "bg-positive" })
    }
  }
  if (group.cancelledAt && a?.status !== "declined") items.push({ at: group.cancelledAt, text: "Shift cancelled", dot: "bg-critical" })
  const sheets = timesheets.filter((t) => t.groupId === group.id)
  const submitted = sheets.map((t) => t.submittedAt).filter(Boolean).sort()
  const submitters = [...new Set(sheets.filter((t) => t.submittedAt).map((t) => t.supplierId))]
  if (submitted.length)
    items.push({
      at: submitted[submitted.length - 1]!,
      text: `${joinNames(submitters.map((id) => supplier(id).shortName))} submitted ${submitted.length} timesheet${submitted.length === 1 ? "" : "s"}`,
      dot: "bg-primary",
    })
  const approved = sheets.filter((t) => t.approvedAt).sort((a, b) => a.approvedAt!.localeCompare(b.approvedAt!))
  if (approved.length) items.push({ at: approved[approved.length - 1].approvedAt!, text: `${approved[0].approvedBy} approved ${approved.length} timesheet${approved.length === 1 ? "" : "s"}`, dot: "bg-positive" })
  const invIds = [...new Set(sheets.map((t) => t.invoiceId).filter(Boolean))]
  for (const id of invIds) {
    const inv = invoices.find((i) => i.id === id)
    if (inv) items.push({ at: new Date(`${inv.issuedOn}T07:00:00`).toISOString(), text: `Billed on invoice ${inv.number}`, dot: "bg-border-strong" })
  }
  return items.sort((a, b) => b.at.localeCompare(a.at))
}

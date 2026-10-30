"use client"

import Link from "next/link"
import { Download, FileText, Layers, Printer, Wallet } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { EmptyState } from "@/components/common/empty-state"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { StatusBadge } from "@/components/common/status-badge"
import { Surface, SurfaceHeader } from "@/components/common/surface"
import { BillingReview } from "@/components/invoices/billing-review"
import { InvoiceStatusBadge, formatDelta } from "@/components/invoices/invoice-bits"
import { PeerComparison } from "@/components/invoices/peer-comparison"
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
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatClockShort, formatDateFull, formatDateShort } from "@/lib/dates"
import { hours, money, plural, rate } from "@/lib/format"
import {
  ANOMALY_THRESHOLD,
  billingFindings,
  inScope,
  invoiceBalance,
  invoiceBenchmark,
  invoiceCredits,
  invoiceExpenseRows,
  invoiceExpenses,
  invoiceHours,
  invoiceStatus,
  invoiceSubtotal,
  invoiceTips,
  invoiceTotal,
  venueTips,
} from "@/lib/metrics"
import { buyer, costCenterOf, location, position, supplier, termsOf } from "@/lib/reference"
import { useStore } from "@/lib/store"
import { EXPENSE_LABEL, expensesOf } from "@/lib/timesheets"
import { cn } from "@/lib/utils"

export function InvoiceDetail({ id }: { id: string }) {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const payInvoices = useStore((s) => s.payInvoices)
  const [payOpen, setPayOpen] = useState(false)
  const inv = data.invoices.find((i) => i.id === id)

  if (!inv || !inScope(scope, inv)) {
    return (
      <div className="pt-10">
        <EmptyState icon={FileText} title="Invoice not found" description="It may belong to another workspace." actions={<Button asChild variant="outline"><Link href="/invoices">Back to Invoices</Link></Button>} />
      </div>
    )
  }

  const isCompass = ws.kind === "compass"
  const sup = supplier(inv.supplierId)
  const status = invoiceStatus(inv)
  const benchmark = invoiceBenchmark(data, inv.id)
  const deltaOf = (lineId: string) => (isCompass ? (benchmark.lineDelta.get(lineId) ?? 0) : 0)
  const isHigh = (lineId: string) => deltaOf(lineId) >= ANOMALY_THRESHOLD
  const group = inv.groupId ? data.invoiceGroups.find((g) => g.id === inv.groupId) : undefined
  const shifts = new Map(data.groups.map((g) => [g.id, g]))
  const costCenters = [...new Set(inv.lines.map((l) => costCenterOf(l.locationId, l.departmentId, l.positionId)))]
  const byDate = [...inv.lines].sort((a, b) => a.date.localeCompare(b.date) || a.proName.localeCompare(b.proName))
  const found = new Set(billingFindings(data, inv.id).map((f) => f.lineId))
  const credits = inv.credits ?? []
  const lines = [...byDate].sort((a, b) => Number(found.has(b.id)) - Number(found.has(a.id)) || Number(isHigh(b.id)) - Number(isHigh(a.id)))
  const tips = venueTips(byDate)
  const expenses = invoiceExpenseRows(byDate)
  const isOpen = status === "open"
  const canPay = ws.kind === "buyer" && invoiceBalance(inv) > 0 && status !== "in_process" && !isOpen

  const download = () =>
    downloadCsv(
      exportName(inv.number.toLowerCase()),
      toCsv(
        byDate.map((l) => ({
          invoice_number: inv.number,
          shift_group_id: (l.groupId && shifts.get(l.groupId)?.code) || "",
          position: position(l.positionId).name,
          location: location(l.locationId).name,
          pro: l.proName,
          date: l.date,
          clock_in: l.clockIn ?? "",
          clock_out: l.clockOut ?? "",
          hours: l.hours,
          bill_rate: l.billRate.toFixed(2),
          tips: l.tips.toFixed(2),
          expenses: expensesOf(l).toFixed(2),
          amount: (l.amount + l.tips + expensesOf(l)).toFixed(2),
          ...(isCompass ? { vs_others_pct: (deltaOf(l.id) * 100).toFixed(1) } : {}),
        })).concat(
          credits.map((c) => ({
            invoice_number: inv.number,
            shift_group_id: "",
            position: `Credit: ${c.reason}`,
            location: "",
            pro: c.proName,
            date: c.date,
            clock_in: "",
            clock_out: "",
            hours: -c.hours,
            bill_rate: "",
            tips: "0.00",
            expenses: "0.00",
            amount: (-c.amount).toFixed(2),
            ...(isCompass ? { vs_others_pct: "" } : {}),
          })),
        ),
      ),
    )

  return (
    <>
      <div className="flex flex-col gap-4 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-featured-1 font-semibold">{inv.number}</h1>
            <InvoiceStatusBadge invoice={inv} />
            {group && (
              <Tip content={group.name}>
                <Link href={`/invoices/groups/${group.id}`}>
                  <StatusBadge>
                    <Layers className="size-3" /> {group.code}
                  </StatusBadge>
                </Link>
              </Tip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body-3 text-faded">
            <span className="inline-flex items-center gap-1.5">
              <SupplierLogo supplierId={sup.id} size="xs" /> {sup.name}
            </span>
            <span>{buyer(inv.buyerId).name}</span>
            <span>
              {formatDateShort(inv.periodStart)} – {formatDateShort(inv.periodEnd)}
            </span>
            {isOpen ? (
              <span>Iris issues it {formatDateFull(inv.issuedOn)}</span>
            ) : (
              <>
                <span>Issued {formatDateFull(inv.issuedOn)}</span>
                <span className={cn(status === "overdue" && "font-semibold text-critical-fg")}>Due {formatDateFull(inv.dueOn)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={download}>
            <Download className="size-4" /> Download CSV
          </Button>
          <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
          {canPay && (
            <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" onClick={() => setPayOpen(true)}>
              <Wallet className="size-4" /> Pay now
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <BillingReview invoice={inv} />
          {isCompass && benchmark.anomalous && <PeerComparison invoice={inv} />}

          <Surface elevated>
            <SurfaceHeader title="Line items" description={`${plural(inv.lines.length, "line")} · ${hours(invoiceHours(inv))}`} />
            <div className="overflow-x-auto px-2 pt-3 pb-2 scrollbar-thin">
              <table className="w-full text-left text-body-3">
                <thead>
                  <tr className="text-caption-1 text-faded">
                    <th className="px-3 py-2 font-medium">Shift</th>
                    <th className="px-3 py-2 font-medium">Worker</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Bill rate</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const shift = l.groupId ? shifts.get(l.groupId) : undefined
                    const delta = deltaOf(l.id)
                    const high = delta >= ANOMALY_THRESHOLD
                    const billed = found.has(l.id)
                    return (
                      <tr
                        key={l.id}
                        className={cn("border-t border-border/80 transition-colors duration-100", billed ? "bg-warning-faded/60" : high ? "bg-critical-faded/40" : "hover:bg-hover")}
                      >
                        <td className="px-3 py-2.5">
                          <span className="flex flex-col">
                            {shift ? (
                              <Link href={`/shifts/${shift.id}`} className="font-medium whitespace-nowrap hover:underline">
                                {position(l.positionId).name}
                              </Link>
                            ) : (
                              <span className="font-medium whitespace-nowrap">{position(l.positionId).name}</span>
                            )}
                            <span className="text-caption-1 whitespace-nowrap text-faded">
                              {location(l.locationId).name}
                              {shift && ` · ${shift.code}`}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{l.proName}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="flex flex-col">
                            {formatDateShort(l.date)}
                            {l.clockIn && l.clockOut && (
                              <span className="text-caption-1 text-faded tabular">
                                {formatClockShort(l.clockIn)}–{formatClockShort(l.clockOut)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {billed ? (
                            <Tip content="Approved as billed, above Iris's clock">
                              <span className="font-semibold text-warning-fg">{l.hours.toFixed(2)}</span>
                            </Tip>
                          ) : (
                            l.hours.toFixed(2)
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {high ? (
                            <Tip content={`${formatDelta(delta)} vs. other agencies' rating-weighted rate for this role, ${rate(l.billRate / (1 + delta))}`}>
                              <span className="font-semibold text-critical-fg">{money(l.billRate)}</span>
                            </Tip>
                          ) : (
                            money(l.billRate)
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular">{money(l.amount)}</td>
                      </tr>
                    )
                  })}
                  {tips.map((v) => (
                    <tr key={v.key} className="border-t border-border/80" data-tour="venue-tips">
                      <td className="px-3 py-2.5">
                        <span className="flex flex-col">
                          <span className="font-medium whitespace-nowrap">{location(v.locationId).name} tips</span>
                          <span className="text-caption-1 whitespace-nowrap text-faded">No markup</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Tip content={<TipSplit workers={v.workers} />}>
                          <span className="cursor-default underline decoration-dotted underline-offset-4">{plural(v.workers.length, "worker")}</span>
                        </Tip>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatDateShort(v.date)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-faded">—</td>
                      <td className="px-3 py-2.5 text-right tabular text-faded">—</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular">{money(v.amount)}</td>
                    </tr>
                  ))}
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-t border-border/80" data-tour="invoice-expense">
                      <td className="px-3 py-2.5">
                        <span className="flex flex-col">
                          <span className="font-medium whitespace-nowrap">{EXPENSE_LABEL[e.kind]}</span>
                          <span className="text-caption-1 whitespace-nowrap text-faded">{e.note ?? `${location(e.line.locationId).name} · at cost`}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{e.line.proName}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatDateShort(e.line.date)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-faded">—</td>
                      <td className="px-3 py-2.5 text-right tabular text-faded">—</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular">{money(e.amount)}</td>
                    </tr>
                  ))}
                  {credits.map((c) => (
                    <tr key={c.id} className="border-t border-border/80 bg-positive-faded/50">
                      <td className="px-3 py-2.5">
                        <span className="flex flex-col">
                          <span className="font-medium whitespace-nowrap">Credit</span>
                          <span className="text-caption-1 whitespace-nowrap text-faded">{c.reason}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{c.proName}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatDateShort(c.date)}</td>
                      <td className="px-3 py-2.5 text-right tabular">−{c.hours.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-faded">—</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular text-positive-fg">−{money(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface elevated>
            <Accordion type="single" collapsible className="px-5">
              <AccordionItem value="pay" className="border-b-0">
                <AccordionTrigger className="text-body-2 font-bold hover:no-underline">Payment information</AccordionTrigger>
                <AccordionContent className="grid gap-4 pb-4 text-body-3 sm:grid-cols-3">
                  <div>
                    <p className="text-caption-1 font-medium text-faded">ACH remittance</p>
                    <p>{sup.name}</p>
                    <p className="text-faded">Routing ••• 0219 · Account ••• 4471</p>
                  </div>
                  <div>
                    <p className="text-caption-1 font-medium text-faded">Terms</p>
                    <p>Net {termsOf(inv.supplierId).netDays} from issue date</p>
                    <p className="text-faded">Paid by ACH through Iris</p>
                  </div>
                  <div>
                    <p className="text-caption-1 font-medium text-faded">Questions</p>
                    <p>{sup.contactName}</p>
                    <p className="text-faded">{sup.contactEmail}</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Surface>
        </div>

        <Surface elevated className="flex flex-col self-start">
          <SurfaceHeader title="Summary" />
          <dl className="flex flex-col gap-2 px-5 pt-4 pb-5 text-body-3">
            <Row label="Labor" hint="Approved hours at the agency's bill rate for each shift's city and role.">
              {money(invoiceSubtotal(inv))}
            </Row>
            <Row label="Tips" hint="One line per venue and day, passed through to the workers with no markup.">
              {money(invoiceTips(inv))}
            </Row>
            {expenses.length > 0 && (
              <Row label="Expenses" hint="Parking, background checks and other costs the agency paid for a shift, billed at cost.">
                {money(invoiceExpenses(inv))}
              </Row>
            )}
            {credits.length > 0 && (
              <Row label="Credits" hint="Hours billed above Iris's clock that the agency credited after Compass sent them back.">
                <span className="text-positive-fg">−{money(invoiceCredits(inv))}</span>
              </Row>
            )}
            <div className="my-1 h-px bg-border" />
            <Row label="Total" strong>
              {money(invoiceTotal(inv))}
            </Row>
            <Row label="Paid">{inv.paidAmount ? `−${money(inv.paidAmount)}` : money(0)}</Row>
            <Row label="Balance" strong>
              {money(invoiceBalance(inv))}
            </Row>
          </dl>
          <div className="flex flex-col gap-1 border-t border-border px-5 py-4 text-caption-1 text-faded">
            <p>
              {isOpen
                ? `Open. Iris adds ${sup.shortName}'s approved hours for the week as they're approved and issues it on ${formatDateFull(inv.issuedOn)}.`
                : `Generated by Iris on ${formatDateFull(inv.issuedOn)} from approved hours.`}
            </p>
            <p>
              Cost centers <span className="font-mono">{costCenters.join(", ")}</span>
            </p>
          </div>
        </Surface>
      </div>

      <AlertDialog open={payOpen} onOpenChange={setPayOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pay {money(invoiceBalance(inv))}?</AlertDialogTitle>
            <AlertDialogDescription>Payment goes to {sup.name} by ACH. The invoice shows In process until it clears.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                payInvoices([inv.id])
                toast.success(`Payment scheduled for ${inv.number}`, { description: "Status is now In process." })
              }}
            >
              Schedule payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Who a venue's tip line goes to, to the cent. */
export function TipSplit({ workers }: { workers: { proName: string; tips: number }[] }) {
  return (
    <span className="flex min-w-44 flex-col gap-0.5">
      {workers.map((w, i) => (
        <span key={`${w.proName}-${i}`} className="flex justify-between gap-4 tabular">
          <span>{w.proName}</span>
          <span>{money(w.tips)}</span>
        </span>
      ))}
    </span>
  )
}

function Row({ label, children, strong, hint }: { label: string; children: React.ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn("flex items-center gap-1", strong ? "font-bold" : "text-faded")}>
        {label} {hint && <InfoTip>{hint}</InfoTip>}
      </dt>
      <dd className={cn("tabular", strong && "text-body-2 font-bold")}>{children}</dd>
    </div>
  )
}

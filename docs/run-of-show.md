# Iris for Compass: run-of-show

The core-workflows session is two and a half hours: five 30-minute blocks in the order of the Fieldglass modules, each a short demo followed by discussion. Plan on about 12 minutes of clicking and 18 of conversation per block. The business-process working session that follows is still to be defined.

App: https://cruber-demo.replit.app (no passcode)

## Before the room

- Open the app 15 minutes early. The first load after a quiet spell can take 20 seconds while Replit wakes the server.
- Sign in as **Priya Raman** (Compass Group USA).
- Reset the data: user menu at the bottom left, **Reset demo data**. Iris regenerates a working program dated today: last night's concert, this week's open invoices, shifts filling now. Rehearsing uses up the stories below, so reset again after any rehearsal.
- Chrome, a window 1440 px wide or more, 100 to 110% zoom, light theme, other tabs and notifications closed.
- To change who you are, use the switcher at the top left. Each person sees only their own organization's data.
- Optional: a phone for the live check-in in block 3.

## Who's who

| Person | Organization | Plays |
|---|---|---|
| Priya Raman | Compass Group USA | The program office. Onboarding, compliance review, reporting |
| Jordan Ellis | Levy · Chicago | A buyer with four venues. Books shifts, approves hours |
| Dana Ruiz | Levy · Chicago | District manager who approves orders over a venue's weekly budget |
| Alicia Moreno | Chartwells · South | A second buyer: campus dining in Atlanta and Dallas |
| Marcus Lee | Instawork | Agency on an API connection, first in Levy's release order |
| Devon Brooks | Crewline Staffing | Agency on an API connection, second |
| Renee Park | Harbor Hospitality | Agency on CSV uploads, third. Bills above the clock and above the market |
| Luis Ortega | Metro Event Staff | Agency on CSV uploads, with the most compliance gaps |

## Fieldglass to Iris

| Fieldglass | Job to be done | Goal | Where it is in Iris |
|---|---|---|---|
| Onboarding | Upload buyer | Easy to create | Units, Add a unit. A buyer's admin can also add one from Settings, Work locations |
| Onboarding | Upload supplier | Easy to create | Agencies, Add an agency |
| Onboarding | Upload rate card | Easy to manage and audit | The agency's page: its rates and every change to them. Supplier Rates compares them all |
| Job Posting | Shift | Easy to create | The chat, the New shift form, CSV upload, Iris predicts |
| Job Seeker | Worker assignment | Easy to view | The shift's Pros and agencies, the agency's Assign Pros |
| Attestations | Compliance | Verification | Professionals, Documents: attest, verify, and Compass's review |
| Timesheet | Timesheet | Easy to edit, view discrepancies | Timesheets: Iris's clock beside what was billed and the schedule |
| Reporting | Reporting | Customized reporting | Reports, and questions in the chat |

## Block 1. Buyer and supplier onboarding (30 min)

**The point:** a new unit or agency works across Iris the moment it's saved: booking, release order, compliance, rates and invoices. Nobody re-keys it.

1. As Priya, open **Units**: the seven units filed under super sector, sector and regional business (Levy · Chicago and Chartwells · South), each with its cost center, the roles it orders, anything it requires beyond the program, and the agencies that staff it. Search finds any unit or department cost center, like LEV-4420-30. A new unit files itself under its buyer. Then **Agencies**: the four agencies with how many markets each covers, insurance status (Metro's certificate expires in 9 days, Harbor's in 18), average markup, workers and compliance. Open **Harbor** to show one agency in one place: performance, rates by city (the 72% bartender markup in red), Pros, paperwork, how it connects, and its rate changes.
2. **Add a unit.** One page, with a summary beside it that fills in as you type.
   - Levy · Chicago, Stadium, "Soldier Field", cost center LEV-4450, "1410 Special Olympics Dr, Chicago, IL", ZIP 60605. Under the ZIP: "Chicago, IL (4 agencies)". The summary shows where it files (Sports & Leisure, Levy, Levy · Chicago) and who staffs it.
   - Roles: the stadium roles come preselected. Tick **Food handler card** under "Every role here also needs" and watch "Could work here today" drop.
   - Departments: Concessions, Bars and Suites come with their own cost centers, LEV-4450-10 to -30.
   - **Add unit**. Iris opens Units with Soldier Field highlighted under Levy · Chicago.
3. In the confirmation, click **Book a shift**. The New shift form opens as Jordan Ellis with Soldier Field selected, only its roles on offer, and the food handler card listed beside the role's own documents. Leave it there: Levy holds orders until 72 hours before doors, which block 2 shows.
4. Back as Priya, on **Agencies**, **Add an agency**.
   - Agency: "Northwind Event Staffing", contact "Alex Rivera", alex@northwindstaff.com, sends hours by CSV.
   - Coverage: Chicago. Add Suite Attendant to the preselected roles.
   - Paperwork: the insurance expiry is prefilled eight months out. Attach any PDF as the certificate. Next stays off until **Master services agreement signed** is ticked.
   - Rate card: each rate starts at what the agencies already in Chicago pay, with a 32% markup, and the last column compares the bill rate with the market. Raise a markup and the last column flags a rate more than 10% above the market.
   - Pros and buyers: 18 Pros from Northwind's roster. Levy · Chicago is checked, and Northwind joins the end of its release order.
   - Review, then **Add agency**. The summary shows 4 rates, 18 Pros with 2 held until their background check clears, and approval for Levy.
5. Click **Open Iris as Northwind**. Alex's dashboard already has a to-do: "2 professionals with missing or expired documents". Iris is holding them from day one.
6. Rate card audit. As Priya, open **Supplier Rates** and scroll to **Rate changes**, the log for every agency. The top entries include Harbor, Bartender, Chicago, about two months back: $27.81 to $35.69 (+28.3%), a 72% markup, CSV upload by Renee Park, flagged "Up 28% at once". That is the rate Harbor's invoices bill at. Filter Agency to Northwind to see its four rates, set at onboarding by Priya, or open Northwind under **Agencies** for the same log scoped to it. **Download** exports the log.

**Say:** one form instead of a spreadsheet and an email thread. Iris checks the address, market, cost center and rates against the market as you type. A unit's requirements are enforced when a Pro is placed, not written in a policy. Every rate change is kept with who, when, how and the before and after, even if the card is later deleted.

**Ask the room:**
- How does a unit get set up in Fieldglass today, who does it, and how long until it can order?
- Which requirements vary by unit: sector training, TIPS or BASSET, drug screens, a minimum rating?
- Who approves a new agency, and what's in the packet?
- Who reviews rate changes, and how often?

## Block 2. Shift creation (30 min)

**The point:** booking takes a sentence or a few clicks, and Iris applies the program's rules on its own: rate cards, release order, budgets, approvals and holds.

1. As Jordan, on the Dashboard, type: "Create 8 bartender shifts at West Loop Arena on [the day after tomorrow] from 4pm to 11pm". Iris drafts a card: 8 Bartenders at West Loop Arena, an estimate of about $1,415 to $1,856, 6.5 paid hours each, the week's budget it fits in, and the release order with each agency's bill rate (Instawork now, Crewline after 4 hours, Harbor after 8). Nothing is booked yet.
2. **Create and send.** "Posted 8 Bartender spots. Instawork has them now, and Crewline and Harbor get whatever's still open, 4 hours apart." Click **View created shift** and watch Instawork fill it live. Crewline and Harbor read "Not needed, already full".
3. Over budget: ask for 40 bartenders at the same time. The card says how far over West Loop Arena's budget for the week that takes it, and that Dana Ruiz approves it first. The button becomes **Send for approval**. Send it, switch to Dana Ruiz (Levy · Chicago, District approvals), open **Approvals**, and **Approve**, with an optional note. Only then do agencies see it.
4. The other ways in, briefly:
   - **New shift** (top right): several dates at once, times, headcount, instructions, tips. Pick Soldier Field to show it offers only that unit's roles and lists the food handler card for all of them.
   - **Iris predicts** on the Dashboard: recurring orders from the last six weeks of shifts, such as "Banquet Server · Riverside Convention Center, every other Tuesday, 12 Pros", each with **Draft shift**.
   - **Upload CSV** on Shifts. Jordan's Dashboard to-do "1 upload waiting on fixes" (on fresh data) opens past uploads with the fixes Iris suggested, like "Use 24-hour time". The upload dialog links there too, under **Past uploads**.
5. Holds: any Levy order more than three days out notes that Levy holds it until 72 hours before the shift, and when Instawork will see it.

**Say:** the rate card prices it, the release order decides who sees it first and when the next agency gets a look, the budget decides whether someone signs off, and the sector's own rules decide when it goes out. Nobody has to remember any of it.

**Ask the room:**
- How are shifts requested today, and how far ahead?
- Who signs off on orders that blow a budget?
- How is the order of agencies decided, and how often does it change?

## Block 3. Worker assignment and compliance (30 min)

**The point:** everyone can see who's coming and from which agency, and nobody works without documents Iris has verified.

1. Assignment, as Jordan: open the shift from block 2. The Pros list shows each person's agency, rating and status, and the agencies panel shows the release order and how each one is filling. Priya's Dashboard flags "4 shifts likely to start under 80% filled" across the program.
2. The agency side, as Devon (Crewline): open an upcoming Levy bartender shift that still has open spots, such as one at West Loop Arena, and click **Assign Pros**. Iris lists who can work and, for everyone else, why not: Aaliyah Alvarez, Crewline's top-rated Chicago bartender, shows "Alcohol server cert expired"; another Pro shows "Booked elsewhere that day". The same check runs whoever assigns: the agency, the buyer, an upload, or Iris filling it.
3. Attest and verify, as Luis (Metro): the Dashboard to-do "8 professionals with missing or expired documents" opens Not compliant. Open **Brianna Foster** (expired background check), go to **Documents**, and click **Renew**.
   - Attach any PDF. Iris reads it and fills in the issuer, report ID and dates.
   - Tick the attestation: "I attest this background check is genuine, current, and belongs to Brianna Foster."
   - **Verify and clear**: "Checking with Sterling…", then "Verified with Sterling", then "Brianna is cleared to work again". Her row now reads "Verified with Sterling, the report ID, attested by Luis Ortega".
4. When it doesn't check out: still on Brianna, **Renew** the **Food handler card**, skip the attachment, type 4471 as the certificate number, attest, and verify. Iris answers "ServSafe has no record of 4471", holds the document for Compass, and takes Brianna back off shifts. Switch to Priya: her Dashboard now has "1 document Iris couldn't verify". Open it and **Accept**, or **Send back** with a note, which lands with Metro.
5. Continuity, if there's time: as Alex (Northwind), add the background checks for the two Pros Iris held at onboarding.
6. Live check-in (needs a phone): user menu, **Demo controls**, **Start a live shift**. Open the link on a phone and clock out. Iris turns the punch into a timesheet on Levy's Timesheets, with Iris check-in as the clock. That's the bridge to block 4.

**Say:** the agency attests, Iris verifies with whoever issued the document, and Compass only looks at the exceptions. A lapsed certificate takes the Pro off shifts the day it lapses, not when someone notices.

**Ask the room:**
- What does attestation look like in Fieldglass today: a checkbox, uploads, audits after the fact?
- Which providers does Compass rely on for background checks and certificates?
- What happens today when a certificate lapses mid-week?

## Block 4. Timesheets (30 min)

**The point:** every hour an agency bills is checked against Iris's own clock and the schedule before anyone approves it, and fixing one is a click with a reason on the record.

1. As Jordan, the Dashboard to-do "71 timesheets to approve" (the count varies) opens **Timesheets**, Needs approval, with the flagged ones first. Each row shows what the agency billed. Where Iris's clock (Iris check-in or the Instawork app) disagrees, it shows in red underneath.
2. The top row is **Nico Price** (Harbor) from last night's concert at West Loop Arena: billed 3:30pm to 1:30am, 9.5 hours. Iris's clock says 4pm to 12:30am, 8 hours. Flags: "Billed above the clock" and "Billed before the start". Iris proposes 8.00 hours, $53.54 less. **Approve at 8.00 hrs**: the correction goes on the timesheet's history, where Harbor sees it.
3. **Approve [N] clean timesheets** (64 on fresh data): everything that matches the clock and the schedule, in one click.
4. Editing: open a flagged one and use **Correct the times** with a reason, or **Reject** it back to the agency with one.
5. Other cases worth a look on fresh data: an Instawork porter at Riverside Convention Center past 40 hours, with overtime split at time and a half; a worker sent home early, billed the four-hour minimum; a Harbor draft missing its clock-out, under **With the agency**.
6. The chat: "Approve yesterday's hours". Iris approves what matches and holds back what it flagged, naming each one.
7. As Renee (Harbor): Timesheets, under **Done**, shows Jordan's correction and why.
8. If invoices come up: approved hours go on the agency's open invoice for the week. Compass can send back hours billed above the clock for a credit, on Invoices, starting with INV-20453. Each agency's invoices are due on its own payment terms. Every month rolls into one consolidated invoice for all of Compass: **Invoices**, **All**, open October to break it down by super sector, sector, regional business and cost center. **Download CSV** carries the same columns.
9. If contracts come up: **Procurement**, **Contracts** lists each agency's spend, VA rebate, payment terms and contract length, with what's offered in the open renewal underneath. In the Chicago renewal, bids rank after VA. Instawork's VA is 12%, the same as Crewline's, so the lower rate wins each role: Crewline's $27.18 on Bartender, Instawork's $23.54 on Concessions Attendant.

**Say:** Fieldglass shows what the agency submitted. Iris shows it next to what actually happened, says what's wrong, and proposes the fix.

**Ask the room:**
- How are disputes over hours handled today, and by whom?
- How often do billed hours run past the schedule or the clock?
- When do hours have to be final for payroll and invoicing?

## Block 5. Reporting (30 min)

**The point:** anyone can build the report they need in seconds, save it for the team, and have Iris email it, and its numbers match every other screen.

1. As Priya, open **Reports**. Compass's saved reports: Weekly spend by agency (emailed every Monday at 7am to Priya Raman and Tom Becker), Agency scorecard, Spend by location, Cost per hour by market, and Billed above the clock.
2. **Weekly spend by agency**: stacked bars by week, a table with the agencies across and a total, and the current week marked "so far".
3. Build one live: Split by **Location**, Only Market **Chicago**, Period **Last 28 days**. Then, from the menu, **Save as a new report** ("Chicago spend by venue"). **Email on a schedule**: every Monday at 7am, add Lena Ortiz, **Save schedule**, then **Send now**. **Download** gives the CSV.
4. **Agency scorecard**: fill rate, no-show rate, time to fill and spend by agency, each compared with the 28 days before. Instawork fills about 94%, Metro about 69%.
5. **Cost per hour by market**: markets down, agencies across. In Chicago, Harbor costs $32.18 an hour against Instawork's $28.35.
6. Ask Iris: "No-show rate by agency by week" or "What did Harbor bill at West Loop Arena last week?" It answers with the totals and an **Open the report** link.
7. Scope: as Jordan, Reports shows only Levy's venues ("Spend by venue", "Agency fill at my venues", "Bartender cost by agency"). An agency sees only its own billing.
8. One source of truth: Priya's Dashboard says West Loop Arena spent $7,853 in the last 7 days, and the report "Spend by location, last 7 days" says $7,853.

**Say:** no export, no pivot table, no ticket to the analytics team. The people who need a number can build it, keep it, and have it arrive every Monday.

**Ask the room:**
- Which reports does Compass build today, from what, and how long do they take?
- Who needs which numbers, and how often?
- Which numbers matter most: fill, spend against budget, markup, compliance?

## Reset points

- **Reset demo data** takes a few seconds. It clears everything done since: units and agencies added, bookings, approvals, verifications, and reports saved live.
- Reset before the meeting, not between blocks. Soldier Field and Northwind from block 1 are useful later.
- What each block needs fresh: block 3 needs Brianna's expired background check, and block 4 needs Nico Price still pending. Blocks 1, 2 and 5 work on any data.

## When something goes wrong

- **Slow first load:** Replit waking up. Open the app early and keep the tab open.
- **A click seems to do nothing:** reload the page. Everything is saved on the server, so nothing is lost.
- **The data is in a strange state:** Reset demo data and pick the block up from its first step.
- **Agencies filling too fast or too slow:** user menu, Demo controls, and turn an agency's automatic staffing off to staff it by hand.
- **Lost the thread:** the **Guided tour** (top bar) walks all five blocks in this order, as the same people, with **Do it for me** on every step: each press makes the next move on screen, with Iris's cursor clicking the button, until the step shows Next. Enter presses whichever of those the card shows, so the whole demo can run on Enter. Pick one part to play just that block, or **Play all**. Starting it resets the demo data for everyone. Mid-tour, the arrows beside the progress bar (or the ← → keys) step back and ahead, and the part name at the top of the card lists every part and the current part's steps to jump to. To change part, click its bar (hover names it), press 1–5, or Shift+← → for the part before or after; the finale's list replays any part.

## If asked what's real

- The workflows, rules and checks are Iris's: placement checks, release order, budgets and approvals, clock comparisons, the rate cap and the rate log, report numbers.
- The connections are simulated in this demo: provider lookups (Sterling, ServSafe, E-Verify), reading attached documents, agencies filling shifts when nobody is signed in as them, and report emails.
- Units and agencies are added by form. Bulk spreadsheet import for them isn't built yet.
- Invoicing is built but not on this agenda.

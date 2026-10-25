# Iris

Iris is a staffing VMS for the Compass program. Compass, location buyers and staffing agencies work in the same six-page workspace with persona-specific data and actions:

- Dashboard
- Shifts
- Supplier Rates
- Professionals
- Invoices
- Uploads

It covers the workflow from agency onboarding and rate uploads through shift fulfillment, hours approval, generated invoices and anomaly review.

## How it works

- **One shared state per demo tenant.** The server owns the data. Each tenant is one document in Postgres, written on every change, with an append-only event log (`iris_events`) recording who did what.
- **Every write is a server command.** The browser sends named commands to `/api/commands`. The server checks that the signed-in workspace may do it (only an agency can staff its shifts, only the buyer approves its hours), applies it, saves it, then streams the change to every signed-in device over `/api/events`.
- **Real people, separate devices.** Each device signs in as a persona at `/sign-in`, so a buyer on a laptop, an agency on a tablet and Compass on a phone all see each other's actions live.
- **A scheduler releases shifts.** Shifts go to agencies in the buyer's order, a tier every few hours, on the server's clock. Agencies nobody is signed in as are staffed by the server so the demo never stalls; an agency someone is playing is left to that person.

Domain rules live in `lib/domain/` and run on the server. `lib/store.ts` is the browser's live copy of the server data.

## Run locally

Requires Node 22 and Postgres.

```bash
cp .env.example .env.local   # point DATABASE_URL at a local database
npm ci
npm run dev
```

Open <http://localhost:4848> and choose a persona. Set `PORT` to use another port. Without `DATABASE_URL`, state lives in server memory until the server restarts.

To act as two people at once, use two browsers (or a private window): each keeps its own session.

## Verify

```bash
npm run check
npm audit --omit=dev
```

## Production

```bash
npm ci
npm run build
PORT=3000 npm start
```

Set `DATABASE_URL`, `IRIS_SESSION_SECRET` and `TZ=America/Chicago`, and optionally `IRIS_DEMO_PASSCODE`. Run exactly one instance: live updates and the scheduler are in-process. The tenant row's version check stops a second instance from overwriting changes it didn't see.

The health endpoint is available at `/api/health`.

## Demo data

- All data is fictional and generated on the server the first time a tenant loads.
- **Reset demo data** in the account menu regenerates the tenant for every connected device.
- Upload parsing and suggested fixes run in the browser; the server checks the reviewed file again before saving it.

## Deployment

Replit configuration is committed in `.replit`. The deployment is Autoscale capped at one machine, because live updates and the scheduler are in-process; when it scales to zero, the next request reloads state from Postgres. Publishing uses a clean install and production build:

```bash
npm ci
npm run build
```

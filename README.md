# CrUber

CrUber is an interactive staffing VMS demo for the Compass program. It gives Compass, location buyers, and staffing suppliers the same six-page workspace with persona-specific data and actions:

- Dashboard
- Shifts
- Supplier Rates
- Professionals
- Invoices
- Uploads

The demo covers the complete workflow from supplier onboarding and rate uploads through shift fulfillment, hours approval, generated invoices, and anomaly review.

## Run locally

Requires Node 22.

```bash
npm ci
npm run dev
```

Open <http://localhost:4848>. Set `PORT` to use another port.

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

The server binds to `0.0.0.0` so the same command works on Replit.

## Demo behavior

- All data is fictional and generated in the browser.
- State is stored in local storage; no database or credentials are required.
- Each browser receives its own independent copy of the demo.
- Use **Reset demo data** in the account menu to restore the seeded story.
- Upload parsing and suggested fixes run locally. Uploaded files are not sent to a server.

## Deployment

Replit configuration is committed in `.replit`. Publishing uses a deterministic clean install and production build:

```bash
npm ci
npm run build
```

The health endpoint is available at `/api/health`.

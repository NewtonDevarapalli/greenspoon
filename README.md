# Green Spoon Cloud Kitchen App

Green Spoon is an Angular web app for healthy cloud-kitchen ordering with:
- Branded marketing pages (`Home`, `Menu`, `About`, `Contact`)
- Cart and checkout
- Razorpay payment flow
- Manual WhatsApp payment + confirmation workflow
- Delivery fee settlement modes (`prepaid`, `collect_at_drop`, `restaurant_settled`)
- OTP-based delivery confirmation with collection capture in dispatch console
- Customer order tracking page (`/track/:orderId`)
- Customer self-service order lookup (`/my-orders`)
- Role-based login for enterprise users (`/login`)
- Backend JWT auth + RBAC for admin/dispatch APIs
- Tenant subscription module (monthly/quarterly/yearly) with operational enforcement
- Master data admin console for users, restaurants, and menu (`/admin/master-data`)
- Admin kitchen order console (`/admin/orders`)
- Dispatch console for rider updates and WhatsApp queue logs (`/admin/dispatch`)

## Tech Stack

- Angular 21 (standalone components)
- TypeScript
- SCSS
- Backend persistence with PostgreSQL + Prisma (HTTP mode)

## Run Locally

Install dependencies:

```bash
npm install
npm run backend:install
```

Configure backend environment (`backend/.env`):
- set `DATABASE_URL` to your PostgreSQL instance
- keep JWT/Razorpay values as needed
- for production baseline, copy from `backend/.env.production.example`

Initialize Prisma (first run):

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
cd ..
```

Or from repo root:

```bash
npm run backend:db:migrate
npm run backend:db:generate
npm run backend:db:seed
```

Start backend API (terminal 1):

```bash
npm run backend:start
```

Start frontend app (terminal 2):

```bash
npm start
```

Open:

`http://localhost:4200/`

## Build

```bash
npm run build
```

Production build output:

`dist/greenspoonfoods/browser`

## Environment Configuration

Files:
- `src/environments/environment.ts` (development)
- `src/environments/environment.prod.ts` (production)

Important fields:

```ts
api: {
  baseUrl: 'http://localhost:3000',
  orderApiMode: 'http' // backend APIs + JWT auth + tenant/subscription enforcement
},
payment: {
  razorpayKeyId: 'rzp_test_replace_with_your_key',
  businessName: 'Green Spoon',
  upiId: 'greenspoon@upi'
}
```

## Payment Flows

### Razorpay
1. Frontend requests backend order (`POST /payments/razorpay/order`)
2. Opens Razorpay checkout
3. Verifies signature (`POST /payments/razorpay/verify`)
4. Creates final order (`POST /orders`)
5. Tracking page polls backend (`GET /tracking/:orderId`)

### WhatsApp Pay (manual)
1. Frontend opens WhatsApp with UPI payment message
2. Customer sends payment proof manually
3. Staff confirms and creates order in app
4. Staff can send confirmation message from checkout screen

## Backend Contract

Full API contract is documented in:

`docs/backend-api-contract.md`

OpenAPI spec for Swagger/Postman import:

`docs/backend-openapi.yaml`

This includes:
- Orders API
- Customer OTP self-service lookup API
- Razorpay API
- Tracking API (recommended for production live tracking)
- WhatsApp confirmation logging endpoint (optional)

## Demo Login Accounts

Use these accounts on `/login` for protected routes:

- `admin@greenspoon.com` / `Admin@123` (platform admin)
- `owner@greenspoon.com` / `Owner@123` (restaurant owner)
- `manager@greenspoon.com` / `Manager@123` (kitchen manager)
- `dispatch@greenspoon.com` / `Dispatch@123` (dispatch lead)
- `customer@greenspoon.com` / `Customer@123` (customer)

## GitHub Pages Build

If deploying to `https://<username>.github.io/greenspoon/`, build with:

```bash
ng build --configuration production --base-href /greenspoon/
```

Then publish `dist/greenspoonfoods/browser`.

## Tests

```bash
npm test
npm run backend:test
```

Monitoring pack (Grafana dashboard + Prometheus alerts):

`ops/monitoring/`

Log shipping pack (Fluent Bit + Vector examples):

`ops/logging/`

Go-live checklist:

`docs/production-checklist.md`

Seed password rotation (post-seed hardening):

`npm run backend:rotate-seed-passwords`

One-shot production bootstrap (PowerShell):

`npm run ops:bootstrap:prod`

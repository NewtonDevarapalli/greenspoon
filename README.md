# Green Spoon Cloud Kitchen App

Green Spoon is an Angular web app for healthy cloud-kitchen ordering with:
- Branded marketing pages (`Home`, `Menu`, `About`, `Contact`)
- Cart and checkout
- Razorpay payment flow
- Manual WhatsApp payment + confirmation workflow
- Customer order tracking page (`/track/:orderId`)
- Admin kitchen order console (`/admin/orders`)
- Dispatch console for rider updates and WhatsApp queue logs (`/admin/dispatch`)

## Tech Stack

- Angular 21 (standalone components)
- TypeScript
- SCSS
- Local storage persistence for local mode

## Run Locally

Install dependencies:

```bash
npm install
npm run backend:install
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
  orderApiMode: 'local' // set to 'http' to use backend APIs
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
- Razorpay API
- Tracking API (recommended for production live tracking)
- WhatsApp confirmation logging endpoint (optional)

## GitHub Pages Build

If deploying to `https://<username>.github.io/greenspoon/`, build with:

```bash
ng build --configuration production --base-href /greenspoon/
```

Then publish `dist/greenspoonfoods/browser`.

## Tests

```bash
npm test
```

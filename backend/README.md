# Green Spoon Backend

Minimal Express backend implementing the API contract used by the frontend.

## Setup

```bash
npm install
npx prisma generate
# apply checked-in migrations
npx prisma migrate deploy
# optional demo data
npx prisma db seed
npm start
```

Default URL: `http://localhost:3000`

## Environment

Copy `.env.example` values into your shell/environment:

- `PORT`
- `DATABASE_URL`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `CORS_ORIGIN`
- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_TTL`
- `REFRESH_TOKEN_TTL_DAYS`
- `DEFAULT_TENANT_ID`
- `CUSTOMER_LOOKUP_OTP_TTL_MS`
- `CUSTOMER_LOOKUP_OTP_MAX_ATTEMPTS`
- `ENABLE_DEBUG_OTP`

## Endpoints

- `GET /health`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /subscriptions/plans`
- `GET /tenants` (platform admin)
- `POST /tenants` (platform admin)
- `GET /tenants/:tenantId/subscription`
- `PUT /tenants/:tenantId/subscription` (platform admin)
- `PATCH /tenants/:tenantId/subscription/status` (platform admin)
- `POST /payments/razorpay/order`
- `POST /payments/razorpay/verify`
- `POST /orders`
- `POST /orders/customer/request-otp`
- `POST /orders/customer/lookup`
- `GET /orders`
- `GET /orders/:orderId`
- `PATCH /orders/:orderId/status`
- `GET /tracking/:orderId`
- `POST /tracking/:orderId/location`
- `POST /notifications/whatsapp/confirmation`

## Notes

- Data is persisted in PostgreSQL through Prisma models.
- Run Prisma migrations before starting in new environments.
- Admin/dispatch endpoints are now protected by JWT + role checks.
- Tenant isolation is enforced on order and tracking operations for non-platform users.
- Order operations are blocked when tenant subscription is not `active` or `trial`.

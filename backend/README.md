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
- `AUTH_PASSWORD_HASH_ROUNDS`
- `AUTH_MAX_FAILED_ATTEMPTS`
- `AUTH_LOCKOUT_MS`
- `AUTH_LOGIN_RATE_WINDOW_MS`
- `AUTH_LOGIN_RATE_MAX_ATTEMPTS`
- `LOG_LEVEL`
- `LOG_FILE_PATH`
- `SERVICE_NAME`
- `SENTRY_DSN`
- `SENTRY_TRACES_SAMPLE_RATE`
- `DATADOG_API_KEY`
- `DATADOG_SITE`
- `DATADOG_SOURCE`
- `PUBLIC_BASE_URL`
- `UPLOAD_DIR`
- `UPLOAD_MAX_FILE_SIZE_MB`
- `DEFAULT_TENANT_ID`
- `CUSTOMER_LOOKUP_OTP_TTL_MS`
- `CUSTOMER_LOOKUP_OTP_MAX_ATTEMPTS`
- `ENABLE_DEBUG_OTP`
- `ENABLE_TRACKING_SIMULATION`

Production baseline env template:

- `backend/.env.production.example`

## Endpoints

- `GET /health`
- `GET /metrics`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /admin/users` (platform admin)
- `POST /admin/users` (platform admin)
- `PATCH /admin/users/:userId` (platform admin)
- `DELETE /admin/users/:userId` (platform admin)
- `GET /admin/roles` (platform admin)
- `GET /admin/audit-logs` (platform admin)
- `GET /admin/restaurants` (platform admin)
- `POST /admin/restaurants` (platform admin)
- `PATCH /admin/restaurants/:restaurantId` (platform admin)
- `GET /admin/menu-items` (platform admin)
- `POST /admin/menu-items` (platform admin)
- `PATCH /admin/menu-items/:menuItemId` (platform admin)
- `POST /admin/uploads/menu-image` (platform admin)
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
- `GET /restaurants`
- `GET /menu-items`
- `GET /uploads/*` (uploaded assets)
- `GET /tracking/:orderId`
- `POST /tracking/:orderId/location`
- `POST /notifications/whatsapp/confirmation`

## Tests

```bash
npm test
```

Rotate seeded demo passwords after seeding:

```bash
npm run rotate:seed-passwords
```

## Notes

- Data is persisted in PostgreSQL through Prisma models.
- Run Prisma migrations before starting in new environments.
- Admin/dispatch endpoints are now protected by JWT + role checks.
- Tenant isolation is enforced on order and tracking operations for non-platform users.
- Order operations are blocked when tenant subscription is not `active` or `trial`.
- Backend is modularized for `auth`, `users`, `tenants`, `orders`, `payments`, `tracking`, `notifications`, `restaurants`, and `menu` at `backend/src/modules/*` with route handler + service + repository layers.
- Structured request logging is enabled with `pino-http` and propagated `x-request-id`.
- Logs can be shipped by stdout collection or via file shipping using `LOG_FILE_PATH`.
- Audit logs are persisted to the `AuditLog` table and exposed to platform admins via `/admin/audit-logs`.
- `/metrics` exposes route/method/status HTTP metrics and external sink delivery counters.
- Optional external error sinks: Sentry (`SENTRY_DSN`) and Datadog Logs intake (`DATADOG_API_KEY`).
- Monitoring artifacts live in `ops/monitoring/` (Grafana dashboard + Prometheus alert rules).
- Log shipping examples live in `ops/logging/` (Fluent Bit + Vector configs).
- Seed data includes demo users, tenants/subscriptions, restaurants, menu items, orders, and tracking.
- Production go-live checklist: `docs/production-checklist.md`.

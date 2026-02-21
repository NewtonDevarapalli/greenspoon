# Production Checklist

Use this checklist before go-live.

Bootstrap script (Windows/PowerShell):

- `ops/deploy/bootstrap-production.ps1`

## Infrastructure

- Provision managed PostgreSQL with automated backups and PITR.
- Set `NODE_ENV=production`.
- Deploy backend behind HTTPS reverse proxy (Nginx/ALB/API Gateway).
- Restrict backend port access to trusted networks.

## Secrets and Config

- Start from `backend/.env.production.example` and create `backend/.env` (or inject equivalent environment variables in your runtime).
- Replace defaults for `JWT_ACCESS_SECRET`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET`.
- Configure `CORS_ORIGIN` to exact frontend domain(s).
- Set `PUBLIC_BASE_URL` to backend public URL.
- Set `ENABLE_DEBUG_OTP=false` and `ENABLE_TRACKING_SIMULATION=false`.
- Configure `LOG_LEVEL=info` (or `warn`) and `LOG_FILE_PATH`.

## Database and Seed

- Run `npm run backend:db:migrate`.
- Run `npm run backend:db:seed` once per environment.
- Run `npm run backend:rotate-seed-passwords` and store generated passwords in your secret manager.
- Verify platform admin account login (`admin@greenspoon.com`).

## Observability

- Scrape `/metrics` into Prometheus.
- Import `ops/monitoring/grafana-dashboard.json` into Grafana.
- Load `ops/monitoring/prometheus-alerts.yaml` into Prometheus.
- Optional bootstrap stack:
  - `docker compose -f ops/monitoring/docker-compose.yml up -d`
- Configure one external error sink:
  - `SENTRY_DSN`, or
  - `DATADOG_API_KEY`.
- Configure log shipping from `ops/logging/`.

## Security and Access

- Enforce role-based access from UI routes and backend guards.
- Restrict `/admin/*` access to platform admins.
- Rotate JWT/access secrets on a defined cadence.
- Enable WAF/rate-limiting at edge in addition to app-level login limiter.

## Functional Verification

- Admin can CRUD tenants/users/restaurants/menu from UI.
- Menu image upload works from local computer via admin UI.
- Public menu and restaurant pages reflect admin updates.
- Auth refresh token rotation works.
- Tenant isolation enforced for orders/tracking APIs.
- Audit logs visible under `/admin/audit-logs`.

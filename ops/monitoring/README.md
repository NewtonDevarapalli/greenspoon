# Monitoring Pack

Artifacts:
- `ops/monitoring/grafana-dashboard.json`: Grafana dashboard for request throughput, 5xx ratio, p95 latency, and error-sink delivery events.
- `ops/monitoring/prometheus-alerts.yaml`: Prometheus alert rules for high 5xx rate, high latency, and error-sink failures.
- `ops/monitoring/docker-compose.yml`: local bootstrap for Prometheus + Alertmanager + Grafana.
- `ops/monitoring/prometheus.yml`: scrape and alerting config.
- `ops/monitoring/alertmanager.yml`: Alertmanager routing config.
- `ops/monitoring/grafana/provisioning/*`: auto-import datasource and dashboard at startup.

Quick start:
1. Ensure backend is reachable at `host.docker.internal:3000` from Docker (adjust `ops/monitoring/prometheus.yml` if needed).
2. Start stack:
   - `docker compose -f ops/monitoring/docker-compose.yml up -d`
3. Open Grafana:
   - `http://localhost:3001`
4. Open Prometheus:
   - `http://localhost:9090`
5. Open Alertmanager:
   - `http://localhost:9093`

Production note:
- Replace the default receiver in `ops/monitoring/alertmanager.yml` with PagerDuty/Slack/email routing.

Required backend env vars for external sinks:
- `SENTRY_DSN` for Sentry error ingestion.
- `DATADOG_API_KEY` (+ optional `DATADOG_SITE`) for Datadog log intake.
- `LOG_FILE_PATH` to also ship logs via file tailing agents (Fluent Bit / Datadog Agent / Vector).

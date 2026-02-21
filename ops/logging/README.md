# Log Shipping Pack

This folder contains sample shippers for production log forwarding.

## Prerequisite

Configure backend file logging so shipper agents can tail a stable file:

```bash
LOG_FILE_PATH=/var/log/greenspoon/backend.log
```

## Option 1: Fluent Bit

1. Use `ops/logging/fluent-bit.conf`.
2. Mount `/var/log/greenspoon` into the Fluent Bit container/host.
3. Set `DATADOG_API_KEY` in the Fluent Bit environment.
4. Start shipper:
   - `docker compose -f ops/logging/docker-compose.logging.yml --profile fluent-bit up -d`

## Option 2: Vector

1. Use `ops/logging/vector.toml`.
2. Mount `/var/log/greenspoon` into the Vector container/host.
3. Set `DATADOG_API_KEY` in the Vector environment.
4. Start shipper:
   - `docker compose -f ops/logging/docker-compose.logging.yml --profile vector up -d`

Both configs ship JSON logs to Datadog Logs HTTP intake.

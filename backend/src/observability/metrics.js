const client = require('prom-client');

function createMetrics() {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });
  const httpLabels = ['method', 'status_code', 'route'];

  const httpRequestCounter = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: httpLabels,
    registers: [register],
  });

  const httpRequestDurationMs = new client.Histogram({
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: httpLabels,
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register],
  });

  const externalErrorSinkCounter = new client.Counter({
    name: 'external_error_sink_events_total',
    help: 'Count of external error sink attempts by sink and outcome',
    labelNames: ['sink', 'outcome'],
    registers: [register],
  });

  function metricRoute(req) {
    if (req && req.route && typeof req.route.path === 'string') {
      const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
      return `${base}${req.route.path}` || '/';
    }
    const rawPath = typeof req?.path === 'string' && req.path.length > 0 ? req.path : '/unknown';
    return rawPath
      .split('/')
      .map((segment) => {
        if (!segment) {
          return segment;
        }
        if (/^\d+$/.test(segment) || /^[0-9a-fA-F-]{8,}$/.test(segment)) {
          return ':id';
        }
        return segment;
      })
      .join('/');
  }

  function middleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = durationNs / 1e6;
        const labels = {
          method: String(req?.method || 'UNKNOWN'),
          status_code: String(res?.statusCode || 0),
          route: metricRoute(req),
        };
        httpRequestCounter.inc(labels);
        httpRequestDurationMs.observe(labels, durationMs);
      } catch {
        // no-op: metrics must never break the request lifecycle
      }
    });
    next();
  }

  async function handler(_req, res) {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }

  return {
    middleware,
    handler,
    recordExternalErrorSink(sink, outcome) {
      try {
        externalErrorSinkCounter.inc({
          sink: String(sink || 'unknown'),
          outcome: String(outcome || 'unknown'),
        });
      } catch {
        // no-op: metrics must never break the request lifecycle
      }
    },
  };
}

module.exports = {
  createMetrics,
};

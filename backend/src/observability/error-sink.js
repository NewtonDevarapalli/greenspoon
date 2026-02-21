function createErrorSink({ logger, metrics }) {
  const service = process.env.SERVICE_NAME || 'greenspoon-backend';
  const environment = process.env.NODE_ENV || 'development';
  const sentryDsn = process.env.SENTRY_DSN;
  const datadogApiKey = process.env.DATADOG_API_KEY;
  const datadogSite = process.env.DATADOG_SITE || 'datadoghq.com';
  const datadogSource = process.env.DATADOG_SOURCE || 'nodejs';

  let sentry = null;
  if (isNonEmptyString(sentryDsn)) {
    try {
      // Optional dependency: enabled only when configured.
      // eslint-disable-next-line global-require
      sentry = require('@sentry/node');
      sentry.init({
        dsn: sentryDsn,
        environment,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
      });
      metrics?.recordExternalErrorSink('sentry', 'enabled');
    } catch (error) {
      logger.warn({ err: error }, 'sentry_init_failed');
      metrics?.recordExternalErrorSink('sentry', 'init_failed');
      sentry = null;
    }
  }

  async function sendDatadogLog(error, context) {
    if (!isNonEmptyString(datadogApiKey)) {
      return;
    }
    const url = `https://http-intake.logs.${datadogSite}/api/v2/logs`;
    const payload = {
      message: error?.message || String(error),
      service,
      status: 'error',
      source: datadogSource,
      ddtags: `env:${environment}`,
      error: serializeError(error),
      context: sanitizeContext(context),
    };
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': datadogApiKey,
      },
      body: JSON.stringify(payload),
    });
  }

  function captureException(error, context = {}) {
    if (!error) {
      return;
    }

    if (sentry) {
      try {
        sentry.captureException(error, {
          extra: sanitizeContext(context),
          tags: {
            service,
            environment,
          },
        });
        metrics?.recordExternalErrorSink('sentry', 'sent');
      } catch (captureError) {
        logger.warn({ err: captureError }, 'sentry_capture_failed');
        metrics?.recordExternalErrorSink('sentry', 'failed');
      }
    }

    if (isNonEmptyString(datadogApiKey)) {
      void sendDatadogLog(error, context)
        .then(() => metrics?.recordExternalErrorSink('datadog', 'sent'))
        .catch((captureError) => {
          logger.warn({ err: captureError }, 'datadog_capture_failed');
          metrics?.recordExternalErrorSink('datadog', 'failed');
        });
    }
  }

  return {
    captureException,
  };
}

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {};
  }
  const next = { ...context };
  delete next.authorization;
  delete next.password;
  delete next.refreshToken;
  return next;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
  createErrorSink,
};

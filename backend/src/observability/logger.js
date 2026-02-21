const pino = require('pino');
const pinoHttp = require('pino-http');

function createLogger() {
  const level = process.env.LOG_LEVEL || 'info';
  const service = process.env.SERVICE_NAME || 'greenspoon-backend';
  const environment = process.env.NODE_ENV || 'development';
  const logFilePath = process.env.LOG_FILE_PATH;
  const streams = [{ stream: process.stdout }];
  if (typeof logFilePath === 'string' && logFilePath.trim().length > 0) {
    streams.push({
      stream: pino.destination({
        dest: logFilePath.trim(),
        mkdir: true,
        sync: false,
      }),
    });
  }

  const logger = pino(
    {
      level,
      base: {
        service,
        environment,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.password',
          'req.body.refreshToken',
          'headers.authorization',
          'password',
          'refreshToken',
        ],
        remove: true,
      },
    },
    pino.multistream(streams)
  );

  const httpLogger = pinoHttp({
    logger,
    customLogLevel(req, res, error) {
      if (error || res.statusCode >= 500) {
        return 'error';
      }
      if (res.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    customProps(req) {
      return {
        requestId: req.id,
        service,
        environment,
      };
    },
  });

  return {
    logger,
    httpLogger,
  };
}

module.exports = {
  createLogger,
};

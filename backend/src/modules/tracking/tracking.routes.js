const { createTrackingRepository } = require('./tracking.repository');
const { createTrackingService } = require('./tracking.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createTrackingHandlers(deps) {
  const repository = createTrackingRepository(deps);
  const service = createTrackingService({
    ...deps,
    repository,
  });

  return {
    getTracking: safe((req, res) => service.getTracking(req, res)),
    updateTrackingLocation: safe((req, res) => service.updateTrackingLocation(req, res)),
  };
}

module.exports = {
  createTrackingHandlers,
};

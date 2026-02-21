const { createNotificationsRepository } = require('./notifications.repository');
const { createNotificationsService } = require('./notifications.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createNotificationsHandlers(deps) {
  const repository = createNotificationsRepository(deps);
  const service = createNotificationsService({
    ...deps,
    repository,
  });

  return {
    queueWhatsAppConfirmation: safe((req, res) => service.queueWhatsAppConfirmation(req, res)),
  };
}

module.exports = {
  createNotificationsHandlers,
};

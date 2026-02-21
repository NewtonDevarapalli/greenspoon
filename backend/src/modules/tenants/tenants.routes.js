const { createTenantsRepository } = require('./tenants.repository');
const { createTenantsService } = require('./tenants.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createTenantsHandlers(deps) {
  const repository = createTenantsRepository(deps);
  const service = createTenantsService({
    ...deps,
    repository,
  });

  return {
    listPlans: safe((req, res) => service.listPlans(req, res)),
    listTenants: safe((req, res) => service.listTenants(req, res)),
    createTenant: safe((req, res) => service.createTenant(req, res)),
    getSubscription: safe((req, res) => service.getSubscription(req, res)),
    replaceSubscription: safe((req, res) => service.replaceSubscription(req, res)),
    patchSubscriptionStatus: safe((req, res) => service.patchSubscriptionStatus(req, res)),
  };
}

module.exports = {
  createTenantsHandlers,
};

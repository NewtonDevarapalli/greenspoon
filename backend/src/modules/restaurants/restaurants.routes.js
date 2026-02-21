const { createRestaurantsRepository } = require('./restaurants.repository');
const { createRestaurantsService } = require('./restaurants.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createRestaurantsHandlers(deps) {
  const repository = createRestaurantsRepository(deps);
  const service = createRestaurantsService({
    ...deps,
    repository,
  });

  return {
    listAdmin: safe((req, res) => service.listAdmin(req, res)),
    listPublic: safe((req, res) => service.listPublic(req, res)),
    create: safe((req, res) => service.create(req, res)),
    update: safe((req, res) => service.update(req, res)),
  };
}

module.exports = {
  createRestaurantsHandlers,
};

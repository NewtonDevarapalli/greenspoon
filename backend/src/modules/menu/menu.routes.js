const { createMenuRepository } = require('./menu.repository');
const { createMenuService } = require('./menu.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createMenuHandlers(deps) {
  const repository = createMenuRepository(deps);
  const service = createMenuService({
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
  createMenuHandlers,
};

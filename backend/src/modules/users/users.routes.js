const { createUsersRepository } = require('./users.repository');
const { createUsersService } = require('./users.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createUsersHandlers(deps) {
  const repository = createUsersRepository(deps);
  const service = createUsersService({
    ...deps,
    repository,
  });

  return {
    listRoles: safe((req, res) => service.listRoles(req, res)),
    list: safe((req, res) => service.list(req, res)),
    create: safe((req, res) => service.create(req, res)),
    update: safe((req, res) => service.update(req, res)),
    deactivate: safe((req, res) => service.deactivate(req, res)),
  };
}

module.exports = {
  createUsersHandlers,
};

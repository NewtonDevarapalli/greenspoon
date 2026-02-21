const { createAuthRepository } = require('./auth.repository');
const { createAuthService } = require('./auth.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createAuthHandlers(deps) {
  const repository = createAuthRepository(deps);
  const service = createAuthService({
    ...deps,
    repository,
  });

  return {
    login: safe((req, res) => service.login(req, res)),
    refresh: safe((req, res) => service.refresh(req, res)),
    logout: safe((req, res) => service.logout(req, res)),
    me: safe((req, res) => service.me(req, res)),
  };
}

module.exports = {
  createAuthHandlers,
};

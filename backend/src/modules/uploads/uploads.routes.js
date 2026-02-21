const { createUploadsRepository } = require('./uploads.repository');
const { createUploadsService } = require('./uploads.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createUploadsHandlers(deps) {
  const repository = createUploadsRepository(deps);
  const service = createUploadsService({
    ...deps,
    repository,
  });

  return {
    uploadMenuImage: safe((req, res) => service.uploadMenuImage(req, res)),
  };
}

module.exports = {
  createUploadsHandlers,
};

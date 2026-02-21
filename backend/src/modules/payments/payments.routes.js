const { createPaymentsRepository } = require('./payments.repository');
const { createPaymentsService } = require('./payments.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createPaymentsHandlers(deps) {
  const repository = createPaymentsRepository(deps);
  const service = createPaymentsService({
    ...deps,
    repository,
  });

  return {
    createRazorpayOrder: safe((req, res) => service.createRazorpayOrder(req, res)),
    verifyRazorpayPayment: safe((req, res) => service.verifyRazorpayPayment(req, res)),
  };
}

module.exports = {
  createPaymentsHandlers,
};

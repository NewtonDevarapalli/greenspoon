const { createOrdersRepository } = require('./orders.repository');
const { createOrdersService } = require('./orders.service');

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createOrdersHandlers(deps) {
  const repository = createOrdersRepository(deps);
  const service = createOrdersService({
    ...deps,
    repository,
  });

  return {
    createOrder: safe((req, res) => service.createOrder(req, res)),
    requestCustomerLookupOtp: safe((req, res) => service.requestCustomerLookupOtp(req, res)),
    lookupCustomerOrders: safe((req, res) => service.lookupCustomerOrders(req, res)),
    getOrder: safe((req, res) => service.getOrder(req, res)),
    listOrders: safe((req, res) => service.listOrders(req, res)),
    updateOrderStatus: safe((req, res) => service.updateOrderStatus(req, res)),
    confirmDelivery: safe((req, res) => service.confirmDelivery(req, res)),
  };
}

module.exports = {
  createOrdersHandlers,
};

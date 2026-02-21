function createPaymentsRepository(deps) {
  const prisma = deps.prisma;

  return {
    async getPaymentOrder(providerOrderId) {
      const row = await prisma.paymentOrder.findUnique({ where: { providerOrderId } });
      return toPaymentOrder(row);
    },
    async upsertPaymentOrder(providerOrderId, payload) {
      const row = await prisma.paymentOrder.upsert({
        where: { providerOrderId },
        update: {
          orderReference: payload.orderReference || '',
          amount: Number.isFinite(payload.amount) ? Math.round(payload.amount) : 0,
          currency: payload.currency || 'INR',
          createdAt: toDate(payload.createdAt),
          payload,
        },
        create: {
          providerOrderId,
          orderReference: payload.orderReference || '',
          amount: Number.isFinite(payload.amount) ? Math.round(payload.amount) : 0,
          currency: payload.currency || 'INR',
          createdAt: toDate(payload.createdAt),
          payload,
        },
      });
      return toPaymentOrder(row);
    },
    async persistPaymentOrders() {
      return undefined;
    },
  };
}

function toPaymentOrder(row) {
  if (!row) {
    return null;
  }
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    providerOrderId: row.providerOrderId,
    orderReference: row.orderReference,
    amount: row.amount,
    currency: row.currency,
    createdAt: row.createdAt.getTime(),
  };
}

function toDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric);
  }
  return new Date();
}

module.exports = {
  createPaymentsRepository,
};

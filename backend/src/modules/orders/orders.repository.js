function createOrdersRepository(deps) {
  const prisma = deps.prisma;

  return {
    async getOrder(orderId) {
      const row = await prisma.order.findUnique({ where: { orderId } });
      return toOrder(row);
    },
    async upsertOrder(orderId, value) {
      const payload = toPlainObject(value);
      const row = await prisma.order.upsert({
        where: { orderId },
        update: {
          tenantId: payload.tenantId || deps.defaultTenantId,
          status: payload.status || 'confirmed',
          createdAt: toDate(payload.createdAt),
          updatedAt: toDate(payload.updatedAt),
          payload,
        },
        create: {
          orderId,
          tenantId: payload.tenantId || deps.defaultTenantId,
          status: payload.status || 'confirmed',
          createdAt: toDate(payload.createdAt),
          updatedAt: toDate(payload.updatedAt),
          payload,
        },
      });
      return toOrder(row);
    },
    async listOrders() {
      const rows = await prisma.order.findMany();
      return rows.map(toOrder).filter(Boolean);
    },
    async getTracking(orderId) {
      const row = await prisma.tracking.findUnique({ where: { orderId } });
      return toTracking(row);
    },
    async upsertTracking(orderId, value) {
      const payload = toPlainObject(value);
      const row = await prisma.tracking.upsert({
        where: { orderId },
        update: {
          tenantId: payload.tenantId || deps.defaultTenantId,
          status: payload.status || 'assigned',
          etaMinutes: Number.isFinite(payload.etaMinutes) ? payload.etaMinutes : 0,
          updatedAt: toDate(payload.updatedAt),
          payload,
        },
        create: {
          orderId,
          tenantId: payload.tenantId || deps.defaultTenantId,
          status: payload.status || 'assigned',
          etaMinutes: Number.isFinite(payload.etaMinutes) ? payload.etaMinutes : 0,
          updatedAt: toDate(payload.updatedAt),
          payload,
        },
      });
      return toTracking(row);
    },
    async getOtp(requestId) {
      const row = await prisma.customerLookupOtp.findUnique({ where: { requestId } });
      return toOtp(row);
    },
    async upsertOtp(requestId, value) {
      const payload = toPlainObject(value);
      const row = await prisma.customerLookupOtp.upsert({
        where: { requestId },
        update: {
          phone: payload.phone || '',
          tenantId: payload.tenantId || deps.defaultTenantId,
          otpCode: payload.otpCode || '',
          attempts: Number.isFinite(payload.attempts) ? payload.attempts : 0,
          createdAt: toDate(payload.createdAt),
          expiresAt: toDate(payload.expiresAt),
        },
        create: {
          requestId,
          phone: payload.phone || '',
          tenantId: payload.tenantId || deps.defaultTenantId,
          otpCode: payload.otpCode || '',
          attempts: Number.isFinite(payload.attempts) ? payload.attempts : 0,
          createdAt: toDate(payload.createdAt),
          expiresAt: toDate(payload.expiresAt),
        },
      });
      return toOtp(row);
    },
    async deleteOtp(requestId) {
      await prisma.customerLookupOtp.deleteMany({ where: { requestId } });
    },
    async listOrdersRaw() {
      const rows = await prisma.order.findMany();
      return rows.map(toOrder).filter(Boolean);
    },
    async listOrdersByTenantAndPhone(tenantId, phoneLast10) {
      const rows = await prisma.order.findMany({
        where: {
          tenantId,
        },
        orderBy: { createdAt: 'desc' },
      });
      const normalizedLast10 = String(phoneLast10 || '');
      return rows
        .map(toOrder)
        .filter((order) => deps.normalizeLast10(deps.normalizePhone(order?.customer?.phone || '')) === normalizedLast10);
    },
    async pruneExpiredOtps(now = Date.now()) {
      await prisma.customerLookupOtp.deleteMany({
        where: {
          expiresAt: { lte: new Date(now) },
        },
      });
    },
    async persistOrders() {
      return undefined;
    },
    async persistTracking() {
      return undefined;
    },
    async persistCustomerLookupOtp() {
      return undefined;
    },
  };
}

function toOrder(row) {
  if (!row) {
    return null;
  }
  const payload = toPlainObject(row.payload);
  return {
    ...payload,
    orderId: row.orderId,
    tenantId: row.tenantId,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toTracking(row) {
  if (!row) {
    return null;
  }
  const payload = toPlainObject(row.payload);
  return {
    ...payload,
    orderId: row.orderId,
    tenantId: row.tenantId,
    status: row.status,
    etaMinutes: row.etaMinutes,
    updatedAt: row.updatedAt.getTime(),
  };
}

function toOtp(row) {
  if (!row) {
    return null;
  }
  return {
    requestId: row.requestId,
    phone: row.phone,
    tenantId: row.tenantId,
    otpCode: row.otpCode,
    attempts: row.attempts,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
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

function toPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  createOrdersRepository,
};

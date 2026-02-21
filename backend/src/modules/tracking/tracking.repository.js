function createTrackingRepository(deps) {
  const prisma = deps.prisma;

  return {
    async getTracking(orderId) {
      const row = await prisma.tracking.findUnique({ where: { orderId } });
      return toTracking(row);
    },
    async upsertTracking(orderId, tracking) {
      const payload = tracking && typeof tracking === 'object' ? tracking : {};
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
    async persistTracking() {
      return undefined;
    },
  };
}

function toTracking(row) {
  if (!row) {
    return null;
  }
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    orderId: row.orderId,
    tenantId: row.tenantId,
    status: row.status,
    etaMinutes: row.etaMinutes,
    updatedAt: row.updatedAt.getTime(),
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
  createTrackingRepository,
};

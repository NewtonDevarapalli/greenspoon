function createNotificationsRepository(deps) {
  const prisma = deps.prisma;

  return {
    async getOrder(orderId) {
      const row = await prisma.order.findUnique({ where: { orderId } });
      if (!row) {
        return null;
      }
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      return {
        ...payload,
        orderId: row.orderId,
        tenantId: row.tenantId,
        status: row.status,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      };
    },
    async appendNotification(notification) {
      const payload = notification && typeof notification === 'object' ? notification : {};
      await prisma.notification.create({
        data: {
          id: deps.notificationStorageId(payload),
          tenantId: payload.tenantId || deps.defaultTenantId,
          orderId: payload.orderId || '',
          channel: payload.channel || 'whatsapp',
          createdAt: toDate(payload.createdAt),
          payload,
        },
      });
      return notification;
    },
    async persistNotifications() {
      return undefined;
    },
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
  createNotificationsRepository,
};

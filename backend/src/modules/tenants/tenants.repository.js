function createTenantsRepository(deps) {
  const prisma = deps.prisma;

  return {
    async listTenants() {
      const [tenantRows, subscriptionRows] = await Promise.all([
        prisma.tenant.findMany(),
        prisma.subscription.findMany(),
      ]);
      const subscriptionMap = new Map(
        subscriptionRows.map((row) => [row.tenantId, toSubscription(row)])
      );
      return tenantRows.map((tenant) => ({
        ...toTenant(tenant),
        subscription: subscriptionMap.get(tenant.tenantId) || null,
      }));
    },
    async getTenant(tenantId) {
      const row = await prisma.tenant.findUnique({ where: { tenantId } });
      return toTenant(row);
    },
    async setTenant(tenantId, tenant) {
      const row = await prisma.tenant.upsert({
        where: { tenantId },
        update: {
          name: tenant.name,
          createdAt: toDate(tenant.createdAt),
          updatedAt: toDate(tenant.updatedAt),
        },
        create: {
          tenantId,
          name: tenant.name,
          createdAt: toDate(tenant.createdAt),
          updatedAt: toDate(tenant.updatedAt),
        },
      });
      return toTenant(row);
    },
    async getSubscription(tenantId) {
      const row = await prisma.subscription.findUnique({ where: { tenantId } });
      return toSubscription(row);
    },
    async setSubscription(tenantId, subscription) {
      const row = await prisma.subscription.upsert({
        where: { tenantId },
        update: {
          plan: subscription.plan,
          status: subscription.status,
          amount: Number.isFinite(subscription.amount) ? Math.round(subscription.amount) : 0,
          currency: subscription.currency || 'INR',
          startAt: toDate(subscription.startAt),
          currentPeriodStart: toDate(subscription.currentPeriodStart),
          currentPeriodEnd: toDate(subscription.currentPeriodEnd),
          updatedAt: toDate(subscription.updatedAt),
        },
        create: {
          tenantId,
          plan: subscription.plan,
          status: subscription.status,
          amount: Number.isFinite(subscription.amount) ? Math.round(subscription.amount) : 0,
          currency: subscription.currency || 'INR',
          startAt: toDate(subscription.startAt),
          currentPeriodStart: toDate(subscription.currentPeriodStart),
          currentPeriodEnd: toDate(subscription.currentPeriodEnd),
          updatedAt: toDate(subscription.updatedAt),
        },
      });
      return toSubscription(row);
    },
    async persistTenants() {
      return undefined;
    },
    async persistSubscriptions() {
      return undefined;
    },
  };
}

function toTenant(row) {
  if (!row) {
    return null;
  }
  return {
    tenantId: row.tenantId,
    name: row.name,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toSubscription(row) {
  if (!row) {
    return null;
  }
  return {
    tenantId: row.tenantId,
    plan: row.plan,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    startAt: row.startAt.getTime(),
    currentPeriodStart: row.currentPeriodStart.getTime(),
    currentPeriodEnd: row.currentPeriodEnd.getTime(),
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
  createTenantsRepository,
};

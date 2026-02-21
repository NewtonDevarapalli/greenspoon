function createRestaurantsRepository(deps) {
  const prisma = deps.prisma;

  return {
    async listRestaurants() {
      const rows = await prisma.restaurant.findMany();
      return rows.map(toRestaurant);
    },
    async getRestaurant(restaurantId) {
      const row = await prisma.restaurant.findUnique({ where: { restaurantId } });
      return toRestaurant(row);
    },
    async upsertRestaurant(restaurantId, restaurant) {
      const row = await prisma.restaurant.upsert({
        where: { restaurantId },
        update: {
          tenantId: restaurant.tenantId || deps.defaultTenantId,
          name: restaurant.name || restaurantId,
          city: restaurant.city || 'Hyderabad',
          isActive: restaurant.isActive !== false,
          createdAt: toDate(restaurant.createdAt),
          updatedAt: toDate(restaurant.updatedAt),
        },
        create: {
          restaurantId,
          tenantId: restaurant.tenantId || deps.defaultTenantId,
          name: restaurant.name || restaurantId,
          city: restaurant.city || 'Hyderabad',
          isActive: restaurant.isActive !== false,
          createdAt: toDate(restaurant.createdAt),
          updatedAt: toDate(restaurant.updatedAt),
        },
      });
      return toRestaurant(row);
    },
    async persistRestaurants() {
      return undefined;
    },
  };
}

function toRestaurant(row) {
  if (!row) {
    return null;
  }
  return {
    restaurantId: row.restaurantId,
    tenantId: row.tenantId,
    name: row.name,
    city: row.city,
    isActive: row.isActive !== false,
    createdAt: row.createdAt.getTime(),
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
  createRestaurantsRepository,
};

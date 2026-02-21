function createMenuRepository(deps) {
  const prisma = deps.prisma;

  return {
    async listMenuItems() {
      const rows = await prisma.menuItem.findMany();
      return rows.map(toMenuItem);
    },
    async getMenuItem(menuItemId) {
      const row = await prisma.menuItem.findUnique({ where: { menuItemId } });
      return toMenuItem(row);
    },
    async upsertMenuItem(menuItemId, menuItem) {
      const row = await prisma.menuItem.upsert({
        where: { menuItemId },
        update: {
          tenantId: menuItem.tenantId || deps.defaultTenantId,
          restaurantId: menuItem.restaurantId || '',
          name: menuItem.name || menuItemId,
          category: menuItem.category || 'General',
          description: menuItem.description || null,
          image: menuItem.image || null,
          price: Number.isFinite(menuItem.price) ? Math.round(menuItem.price) : 0,
          calories: menuItem.calories || null,
          isActive: menuItem.isActive !== false,
          createdAt: toDate(menuItem.createdAt),
          updatedAt: toDate(menuItem.updatedAt),
        },
        create: {
          menuItemId,
          tenantId: menuItem.tenantId || deps.defaultTenantId,
          restaurantId: menuItem.restaurantId || '',
          name: menuItem.name || menuItemId,
          category: menuItem.category || 'General',
          description: menuItem.description || null,
          image: menuItem.image || null,
          price: Number.isFinite(menuItem.price) ? Math.round(menuItem.price) : 0,
          calories: menuItem.calories || null,
          isActive: menuItem.isActive !== false,
          createdAt: toDate(menuItem.createdAt),
          updatedAt: toDate(menuItem.updatedAt),
        },
      });
      return toMenuItem(row);
    },
    async getRestaurant(restaurantId) {
      const row = await prisma.restaurant.findUnique({ where: { restaurantId } });
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
    },
    async getTenant(tenantId) {
      return prisma.tenant.findUnique({ where: { tenantId } });
    },
    async persistMenuItems() {
      return undefined;
    },
  };
}

function toMenuItem(row) {
  if (!row) {
    return null;
  }
  return {
    menuItemId: row.menuItemId,
    tenantId: row.tenantId,
    restaurantId: row.restaurantId,
    name: row.name,
    category: row.category,
    description: row.description || '',
    image: row.image || '',
    price: row.price,
    calories: row.calories || '',
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
  createMenuRepository,
};

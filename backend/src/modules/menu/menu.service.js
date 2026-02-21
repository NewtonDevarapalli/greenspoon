function createMenuService(deps) {
  const repo = deps.repository;

  function toMenuView(item) {
    return {
      menuItemId: item.menuItemId,
      tenantId: item.tenantId,
      restaurantId: item.restaurantId,
      name: item.name,
      category: item.category,
      description: item.description || '',
      image: item.image || '',
      price: item.price,
      calories: item.calories || '',
      isActive: item.isActive !== false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async function listAdmin(req, res) {
    try {
      let items = await repo.listMenuItems();
      if (deps.isNonEmptyString(req.query.tenantId)) {
        const tenantId = String(req.query.tenantId).trim();
        items = items.filter((item) => item.tenantId === tenantId);
      }
      if (deps.isNonEmptyString(req.query.restaurantId)) {
        const restaurantId = String(req.query.restaurantId).trim();
        items = items.filter((item) => item.restaurantId === restaurantId);
      }
      if (deps.isNonEmptyString(req.query.isActive)) {
        const isActive = String(req.query.isActive).trim().toLowerCase() === 'true';
        items = items.filter((item) => item.isActive === isActive);
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json(items.map(toMenuView));
    } catch {
      return deps.sendError(res, 500, 'MENU_READ_FAILED', 'Failed to read menu items.');
    }
  }

  async function listPublic(req, res) {
    try {
      let tenantId = deps.defaultTenantId;
      if (req.auth?.role === 'platform_admin' && deps.isNonEmptyString(req.query.tenantId)) {
        tenantId = String(req.query.tenantId).trim();
      } else if (req.auth?.tenantId) {
        tenantId = req.auth.tenantId;
      } else if (deps.isNonEmptyString(req.query.tenantId)) {
        tenantId = String(req.query.tenantId).trim();
      }
      const restaurantId = deps.isNonEmptyString(req.query.restaurantId)
        ? String(req.query.restaurantId).trim()
        : '';

      let items = (await repo.listMenuItems()).filter((item) => item.tenantId === tenantId && item.isActive !== false);
      if (restaurantId) {
        items = items.filter((item) => item.restaurantId === restaurantId);
      }

      const restaurantIds = [...new Set(items.map((item) => item.restaurantId))];
      const restaurants = await Promise.all(restaurantIds.map((id) => repo.getRestaurant(id)));
      const activeRestaurantIds = new Set(
        restaurants.filter((restaurant) => restaurant && restaurant.isActive !== false).map((restaurant) => restaurant.restaurantId)
      );

      items = items.filter((item) => activeRestaurantIds.has(item.restaurantId));
      items.sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json(items.map(toMenuView));
    } catch {
      return deps.sendError(res, 500, 'MENU_READ_FAILED', 'Failed to read menu items.');
    }
  }

  async function create(req, res) {
    try {
      const { menuItemId, tenantId, restaurantId, name, category, description, image, price, calories, isActive } =
        req.body || {};
      if (
        !deps.isNonEmptyString(menuItemId) ||
        !deps.isNonEmptyString(tenantId) ||
        !deps.isNonEmptyString(restaurantId) ||
        !deps.isNonEmptyString(name) ||
        !deps.isNonEmptyString(category) ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'menuItemId, tenantId, restaurantId, name, category and valid price are required.'
        );
      }

      const normalizedMenuItemId = menuItemId.trim();
      const normalizedTenantId = tenantId.trim();
      const normalizedRestaurantId = restaurantId.trim();
      if (!(await deps.tenantExists(normalizedTenantId))) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
      }
      const restaurant = await repo.getRestaurant(normalizedRestaurantId);
      if (!restaurant) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Restaurant not found.');
      }
      if (restaurant.tenantId !== normalizedTenantId) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'restaurantId tenant mismatch for selected tenant.'
        );
      }
      if (await repo.getMenuItem(normalizedMenuItemId)) {
        return deps.sendError(res, 409, 'DUPLICATE_MENU_ITEM', 'menuItemId already exists.');
      }

      const now = Date.now();
      const created = {
        menuItemId: normalizedMenuItemId,
        tenantId: normalizedTenantId,
        restaurantId: normalizedRestaurantId,
        name: name.trim(),
        category: category.trim(),
        description: deps.isNonEmptyString(description) ? description.trim() : '',
        image: deps.isNonEmptyString(image) ? image.trim() : '',
        price: Math.round(price),
        calories: deps.isNonEmptyString(calories) ? calories.trim() : '',
        isActive: isActive !== false,
        createdAt: now,
        updatedAt: now,
      };
      await repo.upsertMenuItem(normalizedMenuItemId, created);
      await repo.persistMenuItems();
      deps.audit?.({
        action: 'menu_item.create',
        entityType: 'menu_item',
        entityId: created.menuItemId,
        tenantId: created.tenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { restaurantId: created.restaurantId, category: created.category },
      });

      return res.status(201).json(toMenuView(created));
    } catch {
      return deps.sendError(res, 500, 'MENU_CREATE_FAILED', 'Menu item create failed due to server error.');
    }
  }

  async function update(req, res) {
    try {
      const menuItemId = String(req.params.menuItemId || '').trim();
      if (!deps.isNonEmptyString(menuItemId)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'menuItemId is required.');
      }

      const existing = await repo.getMenuItem(menuItemId);
      if (!existing) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Menu item not found.');
      }

      const payload = req.body || {};
      const updates = {};
      if (deps.isNonEmptyString(payload.name)) {
        updates.name = payload.name.trim();
      }
      if (deps.isNonEmptyString(payload.category)) {
        updates.category = payload.category.trim();
      }
      if (deps.isNonEmptyString(payload.description)) {
        updates.description = payload.description.trim();
      }
      if (deps.isNonEmptyString(payload.image)) {
        updates.image = payload.image.trim();
      }
      if (deps.isNonEmptyString(payload.calories)) {
        updates.calories = payload.calories.trim();
      }
      if (typeof payload.isActive === 'boolean') {
        updates.isActive = payload.isActive;
      }
      if (Number.isFinite(payload.price) && payload.price >= 0) {
        updates.price = Math.round(payload.price);
      }
      if (deps.isNonEmptyString(payload.restaurantId)) {
        const nextRestaurantId = payload.restaurantId.trim();
        const restaurant = await repo.getRestaurant(nextRestaurantId);
        if (!restaurant) {
          return deps.sendError(res, 404, 'NOT_FOUND', 'Restaurant not found.');
        }
        updates.restaurantId = nextRestaurantId;
        if (!updates.tenantId) {
          updates.tenantId = restaurant.tenantId;
        }
      }
      if (deps.isNonEmptyString(payload.tenantId)) {
        const nextTenantId = payload.tenantId.trim();
        if (!(await deps.tenantExists(nextTenantId))) {
          return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
        }
        updates.tenantId = nextTenantId;
      }

      const nextTenantId = updates.tenantId || existing.tenantId;
      const nextRestaurantId = updates.restaurantId || existing.restaurantId;
      const restaurant = await repo.getRestaurant(nextRestaurantId);
      if (!restaurant) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Restaurant not found.');
      }
      if (restaurant.tenantId !== nextTenantId) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'restaurantId tenant mismatch for selected tenant.'
        );
      }

      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      };
      await repo.upsertMenuItem(menuItemId, updated);
      await repo.persistMenuItems();
      deps.audit?.({
        action: 'menu_item.update',
        entityType: 'menu_item',
        entityId: updated.menuItemId,
        tenantId: updated.tenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { changedFields: Object.keys(updates) },
      });

      return res.status(200).json(toMenuView(updated));
    } catch {
      return deps.sendError(res, 500, 'MENU_UPDATE_FAILED', 'Menu item update failed due to server error.');
    }
  }

  return {
    listAdmin,
    listPublic,
    create,
    update,
  };
}

module.exports = {
  createMenuService,
};

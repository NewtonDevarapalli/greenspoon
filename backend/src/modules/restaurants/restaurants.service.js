function createRestaurantsService(deps) {
  const repo = deps.repository;

  async function listAdmin(req, res) {
    try {
      let restaurants = await repo.listRestaurants();
      if (deps.isNonEmptyString(req.query.tenantId)) {
        const tenantId = String(req.query.tenantId).trim();
        restaurants = restaurants.filter((entry) => entry.tenantId === tenantId);
      }
      if (deps.isNonEmptyString(req.query.isActive)) {
        const isActive = String(req.query.isActive).trim().toLowerCase() === 'true';
        restaurants = restaurants.filter((entry) => entry.isActive === isActive);
      }
      restaurants.sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json(restaurants);
    } catch {
      return deps.sendError(res, 500, 'RESTAURANTS_READ_FAILED', 'Failed to read restaurants.');
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

      const restaurants = (await repo.listRestaurants())
        .filter((entry) => entry.tenantId === tenantId && entry.isActive !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json(restaurants);
    } catch {
      return deps.sendError(res, 500, 'RESTAURANTS_READ_FAILED', 'Failed to read restaurants.');
    }
  }

  async function create(req, res) {
    try {
      const { restaurantId, tenantId, name, city, isActive } = req.body || {};
      if (
        !deps.isNonEmptyString(restaurantId) ||
        !deps.isNonEmptyString(tenantId) ||
        !deps.isNonEmptyString(name) ||
        !deps.isNonEmptyString(city)
      ) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'restaurantId, tenantId, name, and city are required.'
        );
      }

      const normalizedRestaurantId = restaurantId.trim();
      const normalizedTenantId = tenantId.trim();
      if (!(await deps.tenantExists(normalizedTenantId))) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
      }
      if (await repo.getRestaurant(normalizedRestaurantId)) {
        return deps.sendError(res, 409, 'DUPLICATE_RESTAURANT', 'restaurantId already exists.');
      }

      const now = Date.now();
      const created = {
        restaurantId: normalizedRestaurantId,
        tenantId: normalizedTenantId,
        name: name.trim(),
        city: city.trim(),
        isActive: isActive !== false,
        createdAt: now,
        updatedAt: now,
      };
      await repo.upsertRestaurant(normalizedRestaurantId, created);
      await repo.persistRestaurants();
      deps.audit?.({
        action: 'restaurant.create',
        entityType: 'restaurant',
        entityId: created.restaurantId,
        tenantId: created.tenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
      });

      return res.status(201).json(created);
    } catch {
      return deps.sendError(res, 500, 'RESTAURANT_CREATE_FAILED', 'Restaurant create failed due to server error.');
    }
  }

  async function update(req, res) {
    try {
      const restaurantId = String(req.params.restaurantId || '').trim();
      if (!deps.isNonEmptyString(restaurantId)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'restaurantId is required.');
      }

      const existing = await repo.getRestaurant(restaurantId);
      if (!existing) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Restaurant not found.');
      }

      const payload = req.body || {};
      const updates = {};
      if (deps.isNonEmptyString(payload.name)) {
        updates.name = payload.name.trim();
      }
      if (deps.isNonEmptyString(payload.city)) {
        updates.city = payload.city.trim();
      }
      if (typeof payload.isActive === 'boolean') {
        updates.isActive = payload.isActive;
      }
      if (deps.isNonEmptyString(payload.tenantId)) {
        const nextTenantId = payload.tenantId.trim();
        if (!(await deps.tenantExists(nextTenantId))) {
          return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
        }
        updates.tenantId = nextTenantId;
      }

      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      };
      await repo.upsertRestaurant(restaurantId, updated);
      await repo.persistRestaurants();
      deps.audit?.({
        action: 'restaurant.update',
        entityType: 'restaurant',
        entityId: updated.restaurantId,
        tenantId: updated.tenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { changedFields: Object.keys(updates) },
      });

      return res.status(200).json(updated);
    } catch {
      return deps.sendError(res, 500, 'RESTAURANT_UPDATE_FAILED', 'Restaurant update failed due to server error.');
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
  createRestaurantsService,
};

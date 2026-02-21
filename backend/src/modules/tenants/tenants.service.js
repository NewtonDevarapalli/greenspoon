function createTenantsService(deps) {
  const repo = deps.repository;

  function listPlans(_req, res) {
    return res.status(200).json(Object.values(deps.PLAN_CATALOG));
  }

  async function listTenants(_req, res) {
    const tenants = await repo.listTenants();
    tenants.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
    return res.status(200).json(tenants);
  }

  async function createTenant(req, res) {
    const { tenantId, name, plan, status } = req.body || {};
    if (!deps.isNonEmptyString(tenantId) || !deps.isNonEmptyString(name)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId and name are required.');
    }

    const normalizedTenantId = tenantId.trim();
    if (await repo.getTenant(normalizedTenantId)) {
      return deps.sendError(res, 409, 'DUPLICATE_TENANT', 'tenantId already exists.');
    }

    const selectedPlan = deps.isNonEmptyString(plan) ? String(plan).trim() : 'monthly';
    if (!deps.SUBSCRIPTION_PLANS.has(selectedPlan)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'plan must be monthly, quarterly, or yearly.');
    }
    const selectedStatus = deps.isNonEmptyString(status) ? String(status).trim() : 'trial';
    if (!deps.SUBSCRIPTION_STATUSES.has(selectedStatus)) {
      return deps.sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'status must be trial, active, past_due, suspended, or cancelled.'
      );
    }

    const now = Date.now();
    await repo.setTenant(normalizedTenantId, {
      tenantId: normalizedTenantId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
    });
    await repo.setSubscription(
      normalizedTenantId,
      deps.createSubscriptionRecord({
        tenantId: normalizedTenantId,
        plan: selectedPlan,
        status: selectedStatus,
        startAt: now,
      })
    );
    await repo.persistTenants();
    await repo.persistSubscriptions();
    deps.audit?.({
      action: 'tenant.create',
      entityType: 'tenant',
      entityId: normalizedTenantId,
      tenantId: normalizedTenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: { plan: selectedPlan, status: selectedStatus },
    });

    return res.status(201).json({
      ...(await repo.getTenant(normalizedTenantId)),
      subscription: await repo.getSubscription(normalizedTenantId),
    });
  }

  async function getSubscription(req, res) {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!deps.isNonEmptyString(tenantId)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId is required.');
    }
    if (!(await repo.getTenant(tenantId))) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
    }
    if (!deps.canAccessTenant(req.auth, tenantId)) {
      return deps.sendError(res, 403, 'FORBIDDEN', 'Tenant access denied.');
    }

    return res.status(200).json(
      (await repo.getSubscription(tenantId)) ||
        deps.createSubscriptionRecord({ tenantId, plan: 'monthly', status: 'trial' })
    );
  }

  async function replaceSubscription(req, res) {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!deps.isNonEmptyString(tenantId)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId is required.');
    }
    if (!(await repo.getTenant(tenantId))) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
    }

    const { plan, status, startAt } = req.body || {};
    if (!deps.SUBSCRIPTION_PLANS.has(plan)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'plan must be monthly, quarterly, or yearly.');
    }
    if (!deps.SUBSCRIPTION_STATUSES.has(status)) {
      return deps.sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'status must be trial, active, past_due, suspended, or cancelled.'
      );
    }

    const nextStartAt = Number.isFinite(startAt) ? Number(startAt) : Date.now();
    const next = deps.createSubscriptionRecord({
      tenantId,
      plan,
      status,
      startAt: nextStartAt,
    });
    await repo.setSubscription(tenantId, next);
    await repo.persistSubscriptions();
    deps.audit?.({
      action: 'tenant.subscription.replace',
      entityType: 'subscription',
      entityId: tenantId,
      tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: { plan, status },
    });

    return res.status(200).json(next);
  }

  async function patchSubscriptionStatus(req, res) {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!deps.isNonEmptyString(tenantId)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId is required.');
    }
    const subscription = await repo.getSubscription(tenantId);
    if (!subscription) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Subscription not found.');
    }

    const { status } = req.body || {};
    if (!deps.SUBSCRIPTION_STATUSES.has(status)) {
      return deps.sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'status must be trial, active, past_due, suspended, or cancelled.'
      );
    }

    const updated = {
      ...subscription,
      status,
      updatedAt: Date.now(),
    };
    await repo.setSubscription(tenantId, updated);
    await repo.persistSubscriptions();
    deps.audit?.({
      action: 'tenant.subscription.status_update',
      entityType: 'subscription',
      entityId: tenantId,
      tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: { status },
    });

    return res.status(200).json(updated);
  }

  return {
    listPlans,
    listTenants,
    createTenant,
    getSubscription,
    replaceSubscription,
    patchSubscriptionStatus,
  };
}

module.exports = {
  createTenantsService,
};

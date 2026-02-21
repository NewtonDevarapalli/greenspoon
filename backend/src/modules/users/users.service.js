const crypto = require('crypto');

function createUsersService(deps) {
  const repo = deps.repository;

  function listRoles(_req, res) {
    return res.status(200).json(
      [...deps.USER_ROLES].map((role) => ({
        role,
        label: role.replace(/_/g, ' '),
      }))
    );
  }

  async function list(req, res) {
    let users = await repo.listUsers();

    if (deps.isNonEmptyString(req.query.tenantId)) {
      const tenantId = String(req.query.tenantId).trim();
      users = users.filter((user) => user.tenantId === tenantId);
    }
    if (deps.isNonEmptyString(req.query.role)) {
      const role = String(req.query.role).trim();
      users = users.filter((user) => user.role === role);
    }
    if (deps.isNonEmptyString(req.query.isActive)) {
      const isActive = String(req.query.isActive).trim().toLowerCase() === 'true';
      users = users.filter((user) => user.isActive === isActive);
    }

    users.sort((a, b) => a.email.localeCompare(b.email));
    return res.status(200).json(users.map(deps.publicAuthUser));
  }

  async function create(req, res) {
    try {
      const { email, password, name, role, tenantId, isActive } = req.body || {};
      if (
        !deps.isNonEmptyString(email) ||
        !deps.isNonEmptyString(password) ||
        !deps.isNonEmptyString(name) ||
        !deps.isNonEmptyString(role) ||
        !deps.isNonEmptyString(tenantId)
      ) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'email, password, name, role, and tenantId are required.'
        );
      }

      const normalizedRole = role.trim();
      if (!deps.USER_ROLES.has(normalizedRole)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'role is invalid.');
      }

      const normalizedTenantId = tenantId.trim();
      if (!(await deps.tenantExists(normalizedTenantId))) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (await repo.findUserByEmail(normalizedEmail)) {
        return deps.sendError(res, 409, 'DUPLICATE_USER', 'User with this email already exists.');
      }

      const passwordValidation = deps.validatePasswordStrength(password);
      if (!passwordValidation.ok) {
        return deps.sendError(res, 400, 'WEAK_PASSWORD', passwordValidation.message);
      }

      const now = Date.now();
      const createdUser = {
        userId: `u-${crypto.randomBytes(8).toString('hex')}`,
        email: normalizedEmail,
        passwordHash: await deps.hashPassword(password),
        name: name.trim(),
        role: normalizedRole,
        tenantId: normalizedTenantId,
        isActive: isActive !== false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };

      await repo.addUser(createdUser);
      await repo.persist();
      deps.audit?.({
        action: 'admin.user.create',
        entityType: 'auth_user',
        entityId: createdUser.userId,
        tenantId: createdUser.tenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { role: createdUser.role },
      });

      return res.status(201).json(deps.publicAuthUser(createdUser));
    } catch {
      return deps.sendError(res, 500, 'USER_CREATE_FAILED', 'User create failed due to server error.');
    }
  }

  async function update(req, res) {
    try {
      const userId = String(req.params.userId || '').trim();
      if (!deps.isNonEmptyString(userId)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'userId is required.');
      }

      const existing = await repo.findUserById(userId);
      if (!existing) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'User not found.');
      }

      const payload = req.body || {};
      const updates = {};

      if (deps.isNonEmptyString(payload.email)) {
        const nextEmail = payload.email.trim().toLowerCase();
        const duplicate = await repo.findUserByEmail(nextEmail);
        if (duplicate && duplicate.userId !== existing.userId) {
          return deps.sendError(res, 409, 'DUPLICATE_USER', 'User with this email already exists.');
        }
        updates.email = nextEmail;
      }
      if (deps.isNonEmptyString(payload.name)) {
        updates.name = payload.name.trim();
      }
      if (deps.isNonEmptyString(payload.role)) {
        const nextRole = payload.role.trim();
        if (!deps.USER_ROLES.has(nextRole)) {
          return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'role is invalid.');
        }
        updates.role = nextRole;
      }
      if (deps.isNonEmptyString(payload.tenantId)) {
        const nextTenantId = payload.tenantId.trim();
        if (!(await deps.tenantExists(nextTenantId))) {
          return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
        }
        updates.tenantId = nextTenantId;
      }
      if (typeof payload.isActive === 'boolean') {
        updates.isActive = payload.isActive;
      }
      if (deps.isNonEmptyString(payload.password)) {
        const passwordValidation = deps.validatePasswordStrength(payload.password);
        if (!passwordValidation.ok) {
          return deps.sendError(res, 400, 'WEAK_PASSWORD', passwordValidation.message);
        }
        updates.passwordHash = await deps.hashPassword(payload.password);
        updates.failedLoginAttempts = 0;
        updates.lockedUntil = null;
      }

      const updatedUser = await repo.updateUser(existing.userId, updates);
      if (!updatedUser) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'User not found.');
      }

      await repo.persist();
      deps.audit?.({
        action: 'admin.user.update',
        entityType: 'auth_user',
        entityId: updatedUser.userId,
        tenantId: updatedUser.tenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: {
          changedFields: Object.keys(updates),
        },
      });
      return res.status(200).json(deps.publicAuthUser(updatedUser));
    } catch {
      return deps.sendError(res, 500, 'USER_UPDATE_FAILED', 'User update failed due to server error.');
    }
  }

  async function deactivate(req, res) {
    const userId = String(req.params.userId || '').trim();
    if (!deps.isNonEmptyString(userId)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'userId is required.');
    }

    const updatedUser = await repo.updateUser(userId, {
      isActive: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    if (!updatedUser) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'User not found.');
    }

    await repo.revokeRefreshTokensByUser(userId);
    await repo.persist();
    deps.audit?.({
      action: 'admin.user.deactivate',
      entityType: 'auth_user',
      entityId: updatedUser.userId,
      tenantId: updatedUser.tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
    });
    return res.status(200).json(deps.publicAuthUser(updatedUser));
  }

  return {
    listRoles,
    list,
    create,
    update,
    deactivate,
  };
}

module.exports = {
  createUsersService,
};

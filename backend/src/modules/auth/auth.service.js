function createAuthService(deps) {
  const repo = deps.repository;

  async function login(req, res) {
    try {
      await repo.pruneExpiredRefreshTokens();

      const { email, password } = req.body || {};
      if (!deps.isNonEmptyString(email) || !deps.isNonEmptyString(password)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'email and password are required.');
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await repo.findUserByEmail(normalizedEmail);
      if (!user || !user.isActive) {
        deps.audit?.({
          action: 'auth.login',
          entityType: 'auth_user',
          status: 'failed',
          actorEmail: normalizedEmail,
          details: { reason: 'invalid_credentials_or_inactive' },
        });
        return deps.sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      }

      if (deps.isUserLocked(user)) {
        deps.audit?.({
          action: 'auth.login',
          entityType: 'auth_user',
          entityId: user.userId,
          tenantId: user.tenantId,
          actorUserId: user.userId,
          actorEmail: user.email,
          status: 'blocked',
          details: { reason: 'account_locked', lockedUntil: user.lockedUntil },
        });
        return deps.sendError(
          res,
          423,
          'ACCOUNT_LOCKED',
          'Account is temporarily locked due to repeated failed attempts.',
          {
            lockedUntil: user.lockedUntil,
          }
        );
      }

      const passwordCheck = await deps.verifyAuthPassword(user, password);
      if (!passwordCheck.valid) {
        const failedResult = await deps.recordFailedLogin(user.userId);
        deps.audit?.({
          action: 'auth.login',
          entityType: 'auth_user',
          entityId: user.userId,
          tenantId: user.tenantId,
          actorUserId: user.userId,
          actorEmail: user.email,
          status: failedResult.lockedUntil ? 'locked' : 'failed',
          details: failedResult.lockedUntil
            ? { reason: 'too_many_attempts', lockedUntil: failedResult.lockedUntil }
            : { reason: 'invalid_credentials' },
        });
        return deps.sendError(
          res,
          failedResult.lockedUntil ? 423 : 401,
          failedResult.lockedUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
          failedResult.lockedUntil
            ? 'Account is temporarily locked due to repeated failed attempts.'
            : 'Invalid email or password.',
          failedResult.lockedUntil
            ? {
                lockedUntil: failedResult.lockedUntil,
              }
            : undefined
        );
      }

      await deps.resetLoginFailures(user.userId);

      const accessToken = deps.signAccessToken(user);
      const refreshToken = await deps.issueRefreshToken(user);
      deps.audit?.({
        action: 'auth.login',
        entityType: 'auth_user',
        entityId: user.userId,
        tenantId: user.tenantId,
        actorUserId: user.userId,
        actorEmail: user.email,
        status: 'success',
      });

      return res.status(200).json({
        accessToken,
        tokenType: 'Bearer',
        expiresIn: deps.jwtAccessTtl,
        refreshToken,
        user: deps.publicUser(user),
      });
    } catch {
      return deps.sendError(res, 500, 'AUTH_LOGIN_FAILED', 'Login failed due to server error.');
    }
  }

  async function refresh(req, res) {
    try {
      await repo.pruneExpiredRefreshTokens();

      const { refreshToken } = req.body || {};
      if (!deps.isNonEmptyString(refreshToken)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'refreshToken is required.');
      }

      const tokenRecord = await repo.findRefreshTokenRecord(refreshToken);
      if (!tokenRecord || tokenRecord.expiresAt <= Date.now()) {
        return deps.sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
      }

      const user = await repo.findUserById(tokenRecord.userId);
      if (!user || !user.isActive) {
        await repo.revokeRefreshToken(refreshToken);
        deps.audit?.({
          action: 'auth.refresh',
          entityType: 'auth_user',
          entityId: tokenRecord.userId,
          status: 'failed',
          details: { reason: 'user_missing_or_inactive' },
        });
        return deps.sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token user no longer exists.');
      }

      await repo.revokeRefreshToken(refreshToken);
      const accessToken = deps.signAccessToken(user);
      const nextRefreshToken = await deps.issueRefreshToken(user);
      deps.audit?.({
        action: 'auth.refresh',
        entityType: 'auth_user',
        entityId: user.userId,
        tenantId: user.tenantId,
        actorUserId: user.userId,
        actorEmail: user.email,
        status: 'success',
      });
      return res.status(200).json({
        accessToken,
        tokenType: 'Bearer',
        expiresIn: deps.jwtAccessTtl,
        refreshToken: nextRefreshToken,
        user: deps.publicUser(user),
      });
    } catch {
      return deps.sendError(res, 500, 'AUTH_REFRESH_FAILED', 'Refresh failed due to server error.');
    }
  }

  async function logout(req, res) {
    try {
      const { refreshToken } = req.body || {};
      if (deps.isNonEmptyString(refreshToken)) {
        await repo.revokeRefreshToken(refreshToken);
      } else {
        await repo.revokeRefreshTokensByUser(req.auth.userId);
      }
      deps.audit?.({
        action: 'auth.logout',
        entityType: 'auth_user',
        entityId: req.auth.userId,
        tenantId: req.auth.tenantId,
        actorUserId: req.auth.userId,
        actorEmail: req.auth.email,
        status: 'success',
      });
      return res.status(200).json({ ok: true });
    } catch {
      return deps.sendError(res, 500, 'AUTH_LOGOUT_FAILED', 'Logout failed due to server error.');
    }
  }

  function me(req, res) {
    return res.status(200).json({
      userId: req.auth.userId,
      email: req.auth.email,
      name: req.auth.name,
      role: req.auth.role,
      tenantId: req.auth.tenantId,
    });
  }

  return {
    login,
    refresh,
    logout,
    me,
  };
}

module.exports = {
  createAuthService,
};

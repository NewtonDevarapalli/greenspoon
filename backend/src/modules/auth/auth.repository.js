function createAuthRepository(deps) {
  const prisma = deps.prisma;

  return {
    async findUserByEmail(email) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return null;
      }
      const row = await prisma.authUser.findUnique({ where: { email: normalizedEmail } });
      return toAuthUser(row);
    },
    async findUserById(userId) {
      const normalizedUserId = String(userId || '').trim();
      if (!normalizedUserId) {
        return null;
      }
      const row = await prisma.authUser.findUnique({ where: { userId: normalizedUserId } });
      return toAuthUser(row);
    },
    async pruneExpiredRefreshTokens() {
      await prisma.refreshToken.deleteMany({
        where: {
          expiresAt: { lte: new Date() },
        },
      });
    },
    async findRefreshTokenRecord(rawToken) {
      const normalizedToken = String(rawToken || '').trim();
      if (!normalizedToken) {
        return null;
      }
      const hashedToken = deps.hashRefreshToken(normalizedToken);
      let row = await prisma.refreshToken.findUnique({ where: { token: hashedToken } });
      if (!row) {
        // Legacy fallback for old plaintext token rows.
        row = await prisma.refreshToken.findUnique({ where: { token: normalizedToken } });
        if (row) {
          await prisma.refreshToken.delete({ where: { token: normalizedToken } });
          row = await prisma.refreshToken.upsert({
            where: { token: hashedToken },
            update: {
              userId: row.userId,
              tenantId: row.tenantId,
              createdAt: row.createdAt,
              expiresAt: row.expiresAt,
            },
            create: {
              token: hashedToken,
              userId: row.userId,
              tenantId: row.tenantId,
              createdAt: row.createdAt,
              expiresAt: row.expiresAt,
            },
          });
        }
      }
      if (!row) {
        return null;
      }
      return {
        key: row.token,
        userId: row.userId,
        tenantId: row.tenantId,
        createdAt: toEpochMs(row.createdAt),
        expiresAt: toEpochMs(row.expiresAt),
      };
    },
    async revokeRefreshToken(rawToken) {
      const tokenRecord = await this.findRefreshTokenRecord(rawToken);
      if (!tokenRecord) {
        return;
      }
      await prisma.refreshToken.deleteMany({ where: { token: tokenRecord.key } });
    },
    async revokeRefreshTokensByUser(userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
    },
  };
}

function toAuthUser(row) {
  if (!row) {
    return null;
  }
  return {
    userId: row.userId,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    role: row.role,
    tenantId: row.tenantId,
    isActive: row.isActive !== false,
    failedLoginAttempts: Number.isFinite(row.failedLoginAttempts) ? row.failedLoginAttempts : 0,
    lockedUntil: row.lockedUntil ? toEpochMs(row.lockedUntil) : null,
    lastLoginAt: row.lastLoginAt ? toEpochMs(row.lastLoginAt) : null,
    createdAt: toEpochMs(row.createdAt),
    updatedAt: toEpochMs(row.updatedAt),
  };
}

function toEpochMs(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

module.exports = {
  createAuthRepository,
};

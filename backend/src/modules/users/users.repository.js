function createUsersRepository(deps) {
  const prisma = deps.prisma;

  return {
    async listUsers() {
      const rows = await prisma.authUser.findMany();
      return rows.map(toAuthUser);
    },
    async findUserById(userId) {
      const row = await prisma.authUser.findUnique({ where: { userId } });
      return toAuthUser(row);
    },
    async findUserByEmail(email) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return null;
      }
      const row = await prisma.authUser.findUnique({ where: { email: normalizedEmail } });
      return toAuthUser(row);
    },
    async updateUser(userId, updates) {
      const existing = await prisma.authUser.findUnique({ where: { userId } });
      if (!existing) {
        return null;
      }
      const now = new Date();
      const row = await prisma.authUser.update({
        where: { userId },
        data: {
          email: updates.email ?? undefined,
          passwordHash: updates.passwordHash ?? undefined,
          name: updates.name ?? undefined,
          role: updates.role ?? undefined,
          tenantId: updates.tenantId ?? undefined,
          isActive: typeof updates.isActive === 'boolean' ? updates.isActive : undefined,
          failedLoginAttempts: Number.isFinite(updates.failedLoginAttempts)
            ? updates.failedLoginAttempts
            : undefined,
          lockedUntil: updates.lockedUntil === null ? null : toNullableDate(updates.lockedUntil),
          lastLoginAt: updates.lastLoginAt === null ? null : toNullableDate(updates.lastLoginAt),
          updatedAt: now,
        },
      });
      return toAuthUser(row);
    },
    async addUser(user) {
      const row = await prisma.authUser.create({
        data: {
          userId: user.userId,
          email: user.email.toLowerCase(),
          passwordHash: user.passwordHash,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          isActive: user.isActive !== false,
          failedLoginAttempts: Number.isFinite(user.failedLoginAttempts) ? user.failedLoginAttempts : 0,
          lockedUntil: toNullableDate(user.lockedUntil),
          lastLoginAt: toNullableDate(user.lastLoginAt),
          createdAt: toDate(user.createdAt),
          updatedAt: toDate(user.updatedAt),
        },
      });
      return toAuthUser(row);
    },
    async persist() {
      return undefined;
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
    lockedUntil: row.lockedUntil ? row.lockedUntil.getTime() : null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.getTime() : null,
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

function toNullableDate(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value);
}

module.exports = {
  createUsersRepository,
};

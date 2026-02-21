const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('../src/modules/auth/auth.service');
const { createMockRes, sendError } = require('./helpers/http-mock');

function baseDeps(overrides = {}) {
  const audits = [];
  const user = {
    userId: 'u-1',
    email: 'admin@greenspoon.com',
    name: 'Admin',
    role: 'platform_admin',
    tenantId: 't-1',
    isActive: true,
    lockedUntil: null,
  };
  const repo = {
    async pruneExpiredRefreshTokens() {},
    async findUserByEmail() {
      return user;
    },
    async findUserById() {
      return user;
    },
    async findRefreshTokenRecord(token) {
      if (token === 'rt-old') {
        return {
          key: 'hashed-old',
          userId: user.userId,
          tenantId: user.tenantId,
          expiresAt: Date.now() + 60000,
        };
      }
      return null;
    },
    async revokeRefreshToken() {},
    async revokeRefreshTokensByUser() {},
  };

  return {
    deps: {
      repository: repo,
      sendError,
      isNonEmptyString: (value) => typeof value === 'string' && value.trim().length > 0,
      isUserLocked: () => false,
      verifyAuthPassword: async () => ({ valid: true }),
      recordFailedLogin: async () => ({ lockedUntil: null }),
      resetLoginFailures: async () => {},
      signAccessToken: () => 'access-token',
      issueRefreshToken: () => 'rt-new',
      jwtAccessTtl: '15m',
      publicUser: (entry) => ({
        userId: entry.userId,
        email: entry.email,
        role: entry.role,
        tenantId: entry.tenantId,
      }),
      audit(entry) {
        audits.push(entry);
      },
      ...overrides,
    },
    audits,
    user,
    repo,
  };
}

test('login returns 423 when account is already locked', async () => {
  const { deps, audits, user } = baseDeps({
    isUserLocked: () => true,
  });
  const service = createAuthService(deps);
  const req = {
    body: {
      email: user.email,
      password: 'Admin@123',
    },
  };
  const res = createMockRes();

  await service.login(req, res);

  assert.equal(res.statusCode, 423);
  assert.equal(res.body.code, 'ACCOUNT_LOCKED');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'auth.login');
  assert.equal(audits[0].status, 'blocked');
});

test('login returns 423 and lock audit when failed attempts trigger lockout', async () => {
  const { deps, audits, user } = baseDeps({
    verifyAuthPassword: async () => ({ valid: false }),
    recordFailedLogin: async () => ({ lockedUntil: Date.now() + 300000 }),
  });
  const service = createAuthService(deps);
  const req = {
    body: {
      email: user.email,
      password: 'wrong-password',
    },
  };
  const res = createMockRes();

  await service.login(req, res);

  assert.equal(res.statusCode, 423);
  assert.equal(res.body.code, 'ACCOUNT_LOCKED');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'auth.login');
  assert.equal(audits[0].status, 'locked');
});

test('refresh rotates refresh token and revokes prior token', async () => {
  const revoked = [];
  const { deps, repo, audits } = baseDeps({
    issueRefreshToken: () => 'rt-rotated',
  });
  repo.revokeRefreshToken = async (token) => {
    revoked.push(token);
  };

  const service = createAuthService(deps);
  const req = { body: { refreshToken: 'rt-old' } };
  const res = createMockRes();

  await service.refresh(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.refreshToken, 'rt-rotated');
  assert.deepEqual(revoked, ['rt-old']);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'auth.refresh');
  assert.equal(audits[0].status, 'success');
});

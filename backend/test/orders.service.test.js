const test = require('node:test');
const assert = require('node:assert/strict');
const { createOrdersService } = require('../src/modules/orders/orders.service');
const { createMockRes, sendError } = require('./helpers/http-mock');

function createServiceDeps(overrides = {}) {
  const orders = {};
  const tracking = {};
  const otps = {};
  const audits = [];
  const repository = {
    async getOrder(orderId) {
      return orders[orderId] || null;
    },
    async upsertOrder(orderId, value) {
      orders[orderId] = value;
      return orders[orderId];
    },
    async listOrders() {
      return Object.values(orders);
    },
    async listOrdersRaw() {
      return Object.values(orders);
    },
    async getTracking(orderId) {
      return tracking[orderId] || null;
    },
    async upsertTracking(orderId, value) {
      tracking[orderId] = value;
      return tracking[orderId];
    },
    async getOtp(requestId) {
      return otps[requestId] || null;
    },
    async upsertOtp(requestId, value) {
      otps[requestId] = value;
      return otps[requestId];
    },
    async deleteOtp(requestId) {
      delete otps[requestId];
    },
    async persistOrders() {},
    async persistTracking() {},
    async persistCustomerLookupOtp() {},
  };

  const deps = {
    repository,
    state: { tenants: { 'tenant-a': {}, 'tenant-b': {} } },
    sendError,
    isNonEmptyString: (value) => typeof value === 'string' && value.trim().length > 0,
    validateOrderPayload: () => ({ ok: true }),
    defaultSettlementStatus: () => 'not_applicable',
    resolveTenantId: (_auth, payloadTenantId) => payloadTenantId || 'tenant-a',
    canAccessTenant: (auth, tenantId) => auth?.tenantId === tenantId,
    assertTenantOperational: () => true,
    createInitialTracking: () => ({ status: 'assigned', events: [] }),
    normalizePhone: (value) => String(value || '').replace(/\D/g, ''),
    resolvePublicTenantId: (_auth, requestedTenantId) => requestedTenantId || 'tenant-a',
    pruneExpiredCustomerLookupOtps() {},
    generateNumericOtp: () => '1234',
    customerLookupOtpTtlMs: 300000,
    includeDebugOtp: true,
    normalizeLast10: (value) => String(value || '').slice(-10),
    customerLookupOtpMaxAttempts: 5,
    defaultTenantId: 'tenant-a',
    isPlatformAdmin: (auth) => auth?.role === 'platform_admin',
    parseOptionalTime: () => null,
    toOptionalInt: (_value, fallback) => fallback,
    ORDER_STATUSES: new Set(['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']),
    ORDER_STATUS_TRANSITIONS: {
      confirmed: ['preparing', 'cancelled'],
      preparing: ['out_for_delivery', 'cancelled'],
      out_for_delivery: [],
    },
    upsertTrackingFromOrderStatus() {},
    deliveryStatusLabel: (status) => status,
    audit(entry) {
      audits.push(entry);
    },
    ...overrides,
  };

  return {
    service: createOrdersService(deps),
    audits,
    repository,
  };
}

function sampleOrderPayload(overrides = {}) {
  return {
    orderId: 'GS-9001',
    tenantId: 'tenant-a',
    customer: {
      name: 'Test Customer',
      phone: '9000000000',
    },
    address: {
      line1: 'Street 1',
      city: 'Hyderabad',
    },
    items: [{ id: 'item-1', name: 'Test', type: 'Sprouts', image: 'x', price: 10, calories: '20', quantity: 1 }],
    totals: {
      grandTotal: 100,
    },
    paymentMethod: 'razorpay',
    paymentReference: 'pay_1',
    ...overrides,
  };
}

test('createOrder enforces tenant isolation for authenticated user', async () => {
  const { service } = createServiceDeps({
    resolveTenantId: () => 'tenant-a',
    canAccessTenant: () => false,
  });
  const req = {
    auth: { userId: 'u-2', role: 'manager', tenantId: 'tenant-b' },
    body: sampleOrderPayload({ orderId: 'GS-9002' }),
  };
  const res = createMockRes();

  await service.createOrder(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('getOrder hides cross-tenant orders behind not found', async () => {
  const { service, repository } = createServiceDeps({
    canAccessTenant: () => false,
  });
  await repository.upsertOrder('GS-9003', sampleOrderPayload({ orderId: 'GS-9003', tenantId: 'tenant-a' }));

  const req = {
    auth: { userId: 'u-3', role: 'manager', tenantId: 'tenant-b' },
    params: { orderId: 'GS-9003' },
  };
  const res = createMockRes();

  await service.getOrder(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});

test('listOrders returns only caller tenant for non-platform users', async () => {
  const { service, repository } = createServiceDeps({
    canAccessTenant: (auth, tenantId) => auth?.tenantId === tenantId,
    isPlatformAdmin: () => false,
  });
  await repository.upsertOrder('GS-9004', sampleOrderPayload({ orderId: 'GS-9004', tenantId: 'tenant-a' }));
  await repository.upsertOrder('GS-9005', sampleOrderPayload({ orderId: 'GS-9005', tenantId: 'tenant-b' }));

  const req = {
    auth: { userId: 'u-4', role: 'manager', tenantId: 'tenant-a' },
    query: {},
  };
  const res = createMockRes();

  await service.listOrders(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body), true);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].tenantId, 'tenant-a');
});

test('createOrder writes audit entry on success', async () => {
  const { service, audits } = createServiceDeps();
  const req = {
    auth: { userId: 'u-5', email: 'ops@greenspoon.com', role: 'manager', tenantId: 'tenant-a' },
    body: sampleOrderPayload({ orderId: 'GS-9006', tenantId: 'tenant-a' }),
  };
  const res = createMockRes();

  await service.createOrder(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'order.create');
  assert.equal(audits[0].entityId, 'GS-9006');
  assert.equal(audits[0].tenantId, 'tenant-a');
  assert.equal(audits[0].status, 'success');
});

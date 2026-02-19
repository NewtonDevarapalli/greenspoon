const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const app = express();
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || '*';
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_replace_with_your_key';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
const jwtAccessSecret =
  process.env.JWT_ACCESS_SECRET || 'greenspoon_dev_access_secret_change_me';
const jwtAccessTtl = process.env.JWT_ACCESS_TTL || '15m';
const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'greenspoon-demo-tenant';
const prisma = new PrismaClient();

const ORDER_STATUSES = new Set([
  'created',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);
const DELIVERY_STATUSES = new Set([
  'assigned',
  'picked_up',
  'on_the_way',
  'nearby',
  'delivered',
]);
const ORDER_STATUS_TRANSITIONS = {
  confirmed: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: [],
};
const DELIVERY_FEE_MODES = new Set([
  'prepaid',
  'collect_at_drop',
  'restaurant_settled',
]);
const DELIVERY_SETTLEMENT_STATUSES = new Set([
  'not_applicable',
  'pending_collection',
  'collected',
  'restaurant_settled',
]);
const SUBSCRIPTION_PLANS = new Set(['monthly', 'quarterly', 'yearly']);
const SUBSCRIPTION_STATUSES = new Set([
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]);
const OPERATIONAL_SUBSCRIPTION_STATUSES = new Set(['trial', 'active']);
const customerLookupOtpTtlMs = Number(process.env.CUSTOMER_LOOKUP_OTP_TTL_MS || 300000);
const customerLookupOtpMaxAttempts = Number(process.env.CUSTOMER_LOOKUP_OTP_MAX_ATTEMPTS || 5);
const includeDebugOtp = process.env.ENABLE_DEBUG_OTP !== 'false';
const PLAN_CATALOG = {
  monthly: { plan: 'monthly', durationDays: 30, amount: 4999, currency: 'INR' },
  quarterly: { plan: 'quarterly', durationDays: 90, amount: 13999, currency: 'INR' },
  yearly: { plan: 'yearly', durationDays: 365, amount: 49999, currency: 'INR' },
};
const USER_ROLES = new Set([
  'platform_admin',
  'restaurant_owner',
  'manager',
  'dispatch',
  'kitchen',
  'rider',
  'customer',
]);
const ORDER_ADMIN_ROLES = [
  'platform_admin',
  'restaurant_owner',
  'manager',
  'dispatch',
  'kitchen',
];
const STATUS_UPDATE_ROLES = ['platform_admin', 'restaurant_owner', 'manager', 'kitchen'];
const DELIVERY_CONFIRM_ROLES = [
  'platform_admin',
  'restaurant_owner',
  'manager',
  'dispatch',
  'rider',
];
const TRACKING_UPDATE_ROLES = [
  'platform_admin',
  'restaurant_owner',
  'manager',
  'dispatch',
  'rider',
];
const NOTIFICATION_ROLES = ['platform_admin', 'restaurant_owner', 'manager', 'dispatch'];
const AUTH_USERS = [
  {
    userId: 'u-platform-admin',
    email: 'admin@greenspoon.com',
    password: 'Admin@123',
    name: 'Platform Admin',
    role: 'platform_admin',
    tenantId: 'greenspoon-platform',
  },
  {
    userId: 'u-owner',
    email: 'owner@greenspoon.com',
    password: 'Owner@123',
    name: 'Restaurant Owner',
    role: 'restaurant_owner',
    tenantId: 'greenspoon-demo-tenant',
  },
  {
    userId: 'u-manager',
    email: 'manager@greenspoon.com',
    password: 'Manager@123',
    name: 'Kitchen Manager',
    role: 'manager',
    tenantId: 'greenspoon-demo-tenant',
  },
  {
    userId: 'u-dispatch',
    email: 'dispatch@greenspoon.com',
    password: 'Dispatch@123',
    name: 'Dispatch Lead',
    role: 'dispatch',
    tenantId: 'greenspoon-demo-tenant',
  },
  {
    userId: 'u-customer',
    email: 'customer@greenspoon.com',
    password: 'Customer@123',
    name: 'Green Spoon Customer',
    role: 'customer',
    tenantId: 'greenspoon-demo-tenant',
  },
];

app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
app.use(express.json({ limit: '2mb' }));

const state = {
  orders: {},
  paymentOrders: {},
  tracking: {},
  notifications: [],
  refreshTokens: {},
  tenants: {},
  subscriptions: {},
  customerLookupOtp: {},
};
let persistQueue = Promise.resolve();

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'greenspoon-backend',
    timestamp: Date.now(),
  });
});

app.post('/auth/login', (req, res) => {
  pruneExpiredRefreshTokens();

  const { email, password } = req.body || {};
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'email and password are required.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = AUTH_USERS.find((entry) => entry.email.toLowerCase() === normalizedEmail);
  if (!user || user.password !== password) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const accessToken = signAccessToken(user);
  const refreshToken = issueRefreshToken(user);

  return res.status(200).json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: jwtAccessTtl,
    refreshToken,
    user: publicUser(user),
  });
});

app.post('/auth/refresh', (req, res) => {
  pruneExpiredRefreshTokens();

  const { refreshToken } = req.body || {};
  if (!isNonEmptyString(refreshToken)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'refreshToken is required.');
  }

  const tokenRecord = state.refreshTokens[refreshToken];
  if (!tokenRecord || tokenRecord.expiresAt <= Date.now()) {
    return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  const user = AUTH_USERS.find((entry) => entry.userId === tokenRecord.userId);
  if (!user) {
    revokeRefreshToken(refreshToken);
    return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token user no longer exists.');
  }

  const accessToken = signAccessToken(user);
  return res.status(200).json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: jwtAccessTtl,
    user: publicUser(user),
  });
});

app.post('/auth/logout', requireAuth, (req, res) => {
  const { refreshToken } = req.body || {};
  if (isNonEmptyString(refreshToken)) {
    revokeRefreshToken(refreshToken);
  } else {
    revokeRefreshTokensByUser(req.auth.userId);
  }

  return res.status(200).json({ ok: true });
});

app.get('/auth/me', requireAuth, (req, res) => {
  return res.status(200).json({
    userId: req.auth.userId,
    email: req.auth.email,
    name: req.auth.name,
    role: req.auth.role,
    tenantId: req.auth.tenantId,
  });
});

app.get('/subscriptions/plans', (_req, res) => {
  return res.status(200).json(Object.values(PLAN_CATALOG));
});

app.get('/tenants', requireAuth, requireRole('platform_admin'), (_req, res) => {
  const tenants = Object.values(state.tenants).map((tenant) => ({
    ...tenant,
    subscription: state.subscriptions[tenant.tenantId] || null,
  }));
  tenants.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  return res.status(200).json(tenants);
});

app.post('/tenants', requireAuth, requireRole('platform_admin'), (req, res) => {
  const { tenantId, name, plan, status } = req.body || {};
  if (!isNonEmptyString(tenantId) || !isNonEmptyString(name)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId and name are required.');
  }
  const normalizedTenantId = tenantId.trim();
  if (state.tenants[normalizedTenantId]) {
    return sendError(res, 409, 'DUPLICATE_TENANT', 'tenantId already exists.');
  }

  const selectedPlan = isNonEmptyString(plan) ? String(plan).trim() : 'monthly';
  if (!SUBSCRIPTION_PLANS.has(selectedPlan)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'plan must be monthly, quarterly, or yearly.');
  }
  const selectedStatus = isNonEmptyString(status) ? String(status).trim() : 'trial';
  if (!SUBSCRIPTION_STATUSES.has(selectedStatus)) {
    return sendError(
      res,
      400,
      'INVALID_PAYLOAD',
      'status must be trial, active, past_due, suspended, or cancelled.'
    );
  }

  const now = Date.now();
  state.tenants[normalizedTenantId] = {
    tenantId: normalizedTenantId,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
  };
  state.subscriptions[normalizedTenantId] = createSubscriptionRecord({
    tenantId: normalizedTenantId,
    plan: selectedPlan,
    status: selectedStatus,
    startAt: now,
  });
  persistTenants();
  persistSubscriptions();

  return res.status(201).json({
    ...state.tenants[normalizedTenantId],
    subscription: state.subscriptions[normalizedTenantId],
  });
});

app.get('/tenants/:tenantId/subscription', requireAuth, (req, res) => {
  const tenantId = String(req.params.tenantId || '').trim();
  if (!isNonEmptyString(tenantId)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId is required.');
  }
  if (!state.tenants[tenantId]) {
    return sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
  }
  if (!canAccessTenant(req.auth, tenantId)) {
    return sendError(res, 403, 'FORBIDDEN', 'Tenant access denied.');
  }

  return res.status(200).json(
    state.subscriptions[tenantId] || createSubscriptionRecord({ tenantId, plan: 'monthly', status: 'trial' })
  );
});

app.put(
  '/tenants/:tenantId/subscription',
  requireAuth,
  requireRole('platform_admin'),
  (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!isNonEmptyString(tenantId)) {
      return sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId is required.');
    }
    if (!state.tenants[tenantId]) {
      return sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
    }

    const { plan, status, startAt } = req.body || {};
    if (!SUBSCRIPTION_PLANS.has(plan)) {
      return sendError(res, 400, 'INVALID_PAYLOAD', 'plan must be monthly, quarterly, or yearly.');
    }
    if (!SUBSCRIPTION_STATUSES.has(status)) {
      return sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'status must be trial, active, past_due, suspended, or cancelled.'
      );
    }

    const nextStartAt = Number.isFinite(startAt) ? Number(startAt) : Date.now();
    const next = createSubscriptionRecord({
      tenantId,
      plan,
      status,
      startAt: nextStartAt,
    });
    state.subscriptions[tenantId] = next;
    persistSubscriptions();

    return res.status(200).json(next);
  }
);

app.patch(
  '/tenants/:tenantId/subscription/status',
  requireAuth,
  requireRole('platform_admin'),
  (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!isNonEmptyString(tenantId)) {
      return sendError(res, 400, 'INVALID_PAYLOAD', 'tenantId is required.');
    }
    const subscription = state.subscriptions[tenantId];
    if (!subscription) {
      return sendError(res, 404, 'NOT_FOUND', 'Subscription not found.');
    }

    const { status } = req.body || {};
    if (!SUBSCRIPTION_STATUSES.has(status)) {
      return sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'status must be trial, active, past_due, suspended, or cancelled.'
      );
    }

    const now = Date.now();
    const updated = {
      ...subscription,
      status,
      updatedAt: now,
    };
    state.subscriptions[tenantId] = updated;
    persistSubscriptions();

    return res.status(200).json(updated);
  }
);

app.post('/payments/razorpay/order', (req, res) => {
  const { orderReference, amount, currency } = req.body || {};
  if (!isNonEmptyString(orderReference)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'orderReference is required.');
  }
  if (!isPositiveNumber(amount)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'amount must be greater than 0.');
  }
  if (currency !== 'INR') {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'currency must be INR.');
  }

  const providerOrderId = `order_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
  state.paymentOrders[providerOrderId] = {
    orderReference,
    amount,
    currency,
    createdAt: Date.now(),
  };
  persistPaymentOrders();

  return res.status(200).json({
    provider: 'razorpay',
    providerOrderId,
    amount,
    currency,
    keyId: razorpayKeyId,
  });
});

app.post('/payments/razorpay/verify', (req, res) => {
  const { orderReference, providerOrderId, paymentId, signature } = req.body || {};
  if (
    !isNonEmptyString(orderReference) ||
    !isNonEmptyString(providerOrderId) ||
    !isNonEmptyString(paymentId) ||
    !isNonEmptyString(signature)
  ) {
    return sendError(
      res,
      400,
      'INVALID_PAYLOAD',
      'orderReference, providerOrderId, paymentId, and signature are required.'
    );
  }

  const paymentOrder = state.paymentOrders[providerOrderId];
  if (!paymentOrder) {
    return sendError(res, 404, 'NOT_FOUND', 'Payment order not found.');
  }

  const orderMatches = paymentOrder.orderReference === orderReference;
  let verified = orderMatches;

  if (verified && razorpayKeySecret) {
    const expected = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(`${providerOrderId}|${paymentId}`)
      .digest('hex');
    verified = expected === signature;
  }

  return res.status(200).json({
    verified,
    paymentReference: paymentId,
    message: verified ? 'Payment verified.' : 'Payment verification failed.',
  });
});

app.post('/orders', optionalAuth, (req, res) => {
  const payload = req.body || {};
  const validation = validateOrderPayload(payload);
  if (!validation.ok) {
    return sendError(res, 400, 'INVALID_PAYLOAD', validation.message);
  }

  if (state.orders[payload.orderId]) {
    return sendError(res, 409, 'DUPLICATE_ORDER', 'orderId already exists.');
  }

  const now = Date.now();
  const deliveryFeeMode = payload.deliveryFeeMode || 'prepaid';
  const deliveryFeeSettlementStatus =
    payload.deliveryFeeSettlementStatus || defaultSettlementStatus(deliveryFeeMode);
  const tenantId = resolveTenantId(req.auth, payload.tenantId);
  if (req.auth && !canAccessTenant(req.auth, tenantId)) {
    return sendError(res, 403, 'FORBIDDEN', 'Tenant access denied.');
  }
  if (!assertTenantOperational(res, tenantId)) {
    return;
  }
  const order = {
    ...payload,
    tenantId,
    status: 'confirmed',
    deliveryFeeMode,
    deliveryFeeSettlementStatus,
    deliveryConfirmation: {
      expectedOtp: payload.deliveryConfirmation?.expectedOtp || '',
      otpVerified: Boolean(payload.deliveryConfirmation?.otpVerified),
      proofNote: payload.deliveryConfirmation?.proofNote || undefined,
    },
    createdAt: now,
    updatedAt: now,
  };

  state.orders[order.orderId] = order;
  persistOrders();

  if (!state.tracking[order.orderId]) {
    state.tracking[order.orderId] = createInitialTracking(order);
    persistTracking();
  }

  return res.status(201).json(order);
});

app.post('/orders/customer/request-otp', optionalAuth, (req, res) => {
  const { phone, tenantId } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'phone must contain at least 10 digits.');
  }

  const resolvedTenantId = resolvePublicTenantId(req.auth, tenantId);
  if (!state.tenants[resolvedTenantId]) {
    return sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
  }

  pruneExpiredCustomerLookupOtps();

  const now = Date.now();
  const requestId = `otp_${now}_${Math.floor(Math.random() * 900 + 100)}`;
  const otpCode = generateNumericOtp();
  const expiresAt = now + customerLookupOtpTtlMs;
  state.customerLookupOtp[requestId] = {
    requestId,
    phone: normalizedPhone,
    tenantId: resolvedTenantId,
    otpCode,
    attempts: 0,
    createdAt: now,
    expiresAt,
  };
  persistCustomerLookupOtp();

  const responsePayload = {
    requestId,
    expiresAt,
  };
  if (includeDebugOtp) {
    responsePayload.debugOtp = otpCode;
  }

  return res.status(200).json(responsePayload);
});

app.post('/orders/customer/lookup', optionalAuth, (req, res) => {
  const { phone, requestId, otpCode } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'phone must contain at least 10 digits.');
  }
  if (!isNonEmptyString(requestId) || !isNonEmptyString(otpCode)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'requestId and otpCode are required.');
  }

  pruneExpiredCustomerLookupOtps();
  const otpRecord = state.customerLookupOtp[requestId];
  if (!otpRecord) {
    return sendError(res, 400, 'OTP_REQUEST_INVALID', 'OTP request is invalid or expired.');
  }

  const resolvedTenantId = resolvePublicTenantId(req.auth, otpRecord.tenantId);
  if (otpRecord.tenantId !== resolvedTenantId) {
    return sendError(res, 403, 'FORBIDDEN', 'Tenant access denied.');
  }

  const expectedPhoneLast10 = normalizeLast10(otpRecord.phone);
  const providedPhoneLast10 = normalizeLast10(normalizedPhone);
  if (expectedPhoneLast10 !== providedPhoneLast10) {
    return sendError(res, 400, 'PHONE_MISMATCH', 'phone does not match OTP request.');
  }

  if (otpRecord.otpCode !== String(otpCode).trim()) {
    const attempts = Number.isFinite(otpRecord.attempts) ? otpRecord.attempts + 1 : 1;
    if (attempts >= customerLookupOtpMaxAttempts) {
      delete state.customerLookupOtp[requestId];
      persistCustomerLookupOtp();
      return sendError(
        res,
        400,
        'OTP_ATTEMPTS_EXCEEDED',
        'Maximum OTP attempts exceeded. Please request a new OTP.'
      );
    }

    state.customerLookupOtp[requestId] = {
      ...otpRecord,
      attempts,
    };
    persistCustomerLookupOtp();
    return sendError(res, 400, 'INVALID_OTP', 'Invalid OTP. Please try again.', {
      attemptsRemaining: customerLookupOtpMaxAttempts - attempts,
    });
  }

  delete state.customerLookupOtp[requestId];
  persistCustomerLookupOtp();

  const orders = Object.values(state.orders)
    .filter((order) => {
      const orderPhone = normalizePhone(order?.customer?.phone || '');
      const orderTenantId = isNonEmptyString(order?.tenantId) ? order.tenantId : defaultTenantId;
      return (
        orderTenantId === otpRecord.tenantId &&
        normalizeLast10(orderPhone) === providedPhoneLast10
      );
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return res.status(200).json(orders);
});

app.get('/orders/:orderId', optionalAuth, (req, res) => {
  const order = state.orders[req.params.orderId];
  if (!order) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  if (req.auth && !canAccessTenant(req.auth, order.tenantId || defaultTenantId)) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  return res.status(200).json(order);
});

app.get('/orders', requireAuth, requireRole(...ORDER_ADMIN_ROLES), (req, res) => {
  let orders = Object.values(state.orders);
  if (!isPlatformAdmin(req.auth)) {
    orders = orders.filter((order) =>
      canAccessTenant(req.auth, order.tenantId || defaultTenantId)
    );
  } else if (isNonEmptyString(req.query.tenantId)) {
    orders = orders.filter((order) => (order.tenantId || defaultTenantId) === req.query.tenantId);
  }

  if (isNonEmptyString(req.query.status)) {
    orders = orders.filter((order) => order.status === req.query.status);
  }

  const fromTime = parseOptionalTime(req.query.from);
  if (fromTime !== null) {
    orders = orders.filter((order) => order.createdAt >= fromTime);
  }

  const toTime = parseOptionalTime(req.query.to);
  if (toTime !== null) {
    orders = orders.filter((order) => order.createdAt <= toTime);
  }

  orders.sort((a, b) => b.createdAt - a.createdAt);

  const offset = toOptionalInt(req.query.offset, 0);
  const limit = toOptionalInt(req.query.limit, orders.length);
  orders = orders.slice(offset, offset + limit);

  return res.status(200).json(orders);
});

app.patch(
  '/orders/:orderId/status',
  requireAuth,
  requireRole(...STATUS_UPDATE_ROLES),
  (req, res) => {
  const orderId = req.params.orderId;
  const order = state.orders[orderId];
  if (!order) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  if (!canAccessTenant(req.auth, order.tenantId || defaultTenantId)) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  if (!assertTenantOperational(res, order.tenantId || defaultTenantId)) {
    return;
  }

  const { status } = req.body || {};
  if (!ORDER_STATUSES.has(status)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid order status.');
  }

  const allowed = ORDER_STATUS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return sendError(res, 400, 'INVALID_TRANSITION', 'Invalid status transition.');
  }

  const updated = {
    ...order,
    status,
    updatedAt: Date.now(),
  };
  state.orders[orderId] = updated;
  persistOrders();

  upsertTrackingFromOrderStatus(updated);

  return res.status(200).json(updated);
  }
);

app.post(
  '/orders/:orderId/delivery-confirmation',
  requireAuth,
  requireRole(...DELIVERY_CONFIRM_ROLES),
  (req, res) => {
  const orderId = req.params.orderId;
  const order = state.orders[orderId];
  if (!order) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  if (!canAccessTenant(req.auth, order.tenantId || defaultTenantId)) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  if (!assertTenantOperational(res, order.tenantId || defaultTenantId)) {
    return;
  }

  const {
    otpCode,
    proofNote,
    confirmedBy,
    collectDeliveryFee,
    collectionAmount,
    collectionMethod,
    collectionNotes,
  } = req.body || {};

  if (!isNonEmptyString(otpCode)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'otpCode is required.');
  }
  if (!isNonEmptyString(confirmedBy)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'confirmedBy is required.');
  }

  const expectedOtp = order.deliveryConfirmation?.expectedOtp;
  const otpVerified = !isNonEmptyString(expectedOtp) || expectedOtp === otpCode;
  if (!otpVerified) {
    return sendError(res, 400, 'INVALID_OTP', 'Invalid delivery OTP.');
  }

  const now = Date.now();
  let nextSettlement = order.deliveryFeeSettlementStatus || defaultSettlementStatus(order.deliveryFeeMode);
  let deliveryFeeCollection = order.deliveryFeeCollection;

  if (order.deliveryFeeMode === 'collect_at_drop') {
    if (collectDeliveryFee) {
      const amount = Number(collectionAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        return sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'collectionAmount must be a non-negative number.'
        );
      }
      if (!['cash', 'upi'].includes(collectionMethod)) {
        return sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'collectionMethod must be cash or upi.'
        );
      }

      nextSettlement = 'collected';
      deliveryFeeCollection = {
        amountCollected: amount,
        method: collectionMethod,
        collectedAt: now,
        collectedBy: confirmedBy,
        notes: isNonEmptyString(collectionNotes) ? collectionNotes : undefined,
      };
    } else {
      nextSettlement = 'pending_collection';
    }
  } else if (order.deliveryFeeMode === 'restaurant_settled') {
    nextSettlement = 'restaurant_settled';
  } else {
    nextSettlement = 'not_applicable';
  }

  const updated = {
    ...order,
    status: 'delivered',
    deliveryFeeSettlementStatus: nextSettlement,
    deliveryFeeCollection,
    deliveryConfirmation: {
      ...order.deliveryConfirmation,
      receivedOtp: otpCode,
      otpVerified: true,
      proofNote: isNonEmptyString(proofNote) ? proofNote : undefined,
      deliveredAt: now,
      confirmedBy,
    },
    updatedAt: now,
  };

  state.orders[orderId] = updated;
  persistOrders();

  const tracking = state.tracking[orderId];
  if (tracking) {
    const lastStatus = tracking.events[tracking.events.length - 1]?.status;
    const events =
      lastStatus === 'delivered'
        ? tracking.events
        : [
            ...tracking.events,
            {
              status: 'delivered',
              label: deliveryStatusLabel('delivered'),
              time: now,
            },
          ];
    state.tracking[orderId] = {
      ...tracking,
      status: 'delivered',
      etaMinutes: 0,
      events,
      updatedAt: now,
    };
    persistTracking();
  }

  return res.status(200).json(updated);
  }
);

app.get('/tracking/:orderId', optionalAuth, (req, res) => {
  const tracking = state.tracking[req.params.orderId];
  if (!tracking) {
    return sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
  }
  if (req.auth && !canAccessTenant(req.auth, tracking.tenantId || defaultTenantId)) {
    return sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
  }
  return res.status(200).json(tracking);
});

app.post(
  '/tracking/:orderId/location',
  requireAuth,
  requireRole(...TRACKING_UPDATE_ROLES),
  (req, res) => {
  const orderId = req.params.orderId;
  const tracking = state.tracking[orderId];
  if (!tracking) {
    return sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
  }
  if (!canAccessTenant(req.auth, tracking.tenantId || defaultTenantId)) {
    return sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
  }
  if (!assertTenantOperational(res, tracking.tenantId || defaultTenantId)) {
    return;
  }

  const { lat, lng, status, etaMinutes } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'lat and lng are required.');
  }
  if (!DELIVERY_STATUSES.has(status)) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid delivery status.');
  }
  if (!Number.isFinite(etaMinutes) || etaMinutes < 0) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'etaMinutes must be >= 0.');
  }

  const now = Date.now();
  const lastStatus = tracking.events[tracking.events.length - 1]?.status;
  const events =
    lastStatus === status
      ? tracking.events
      : [
          ...tracking.events,
          {
            status,
            label: deliveryStatusLabel(status),
            time: now,
          },
        ];

  state.tracking[orderId] = {
    ...tracking,
    status,
    etaMinutes,
    current: { lat, lng },
    events,
    updatedAt: now,
  };
  persistTracking();

  return res.status(200).json({ ok: true });
  }
);

app.post(
  '/notifications/whatsapp/confirmation',
  requireAuth,
  requireRole(...NOTIFICATION_ROLES),
  (req, res) => {
  const { orderId, customerName, customerPhone, message } = req.body || {};
  if (
    !isNonEmptyString(orderId) ||
    !isNonEmptyString(customerName) ||
    !isNonEmptyString(customerPhone) ||
    !isNonEmptyString(message)
  ) {
    return sendError(
      res,
      400,
      'INVALID_PAYLOAD',
      'orderId, customerName, customerPhone, and message are required.'
    );
  }

  const order = state.orders[orderId];
  if (!order || !canAccessTenant(req.auth, order.tenantId || defaultTenantId)) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  if (!assertTenantOperational(res, order.tenantId || defaultTenantId)) {
    return;
  }

  const providerMessageId = `wamid.${crypto.randomBytes(8).toString('hex')}`;
  state.notifications.push({
    tenantId: order.tenantId || defaultTenantId,
    orderId,
    customerName,
    customerPhone,
    message,
    channel: 'whatsapp',
    queued: true,
    providerMessageId,
    createdAt: Date.now(),
  });
  persistNotifications();

  return res.status(200).json({
    queued: true,
    channel: 'whatsapp',
    providerMessageId,
  });
  }
);

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is missing.');
  }

  try {
    const payload = jwt.verify(token, jwtAccessSecret);
    if (!payload || !USER_ROLES.has(payload.role)) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Invalid authorization token.');
    }
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      tenantId: payload.tenantId,
    };
    return next();
  } catch {
    return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is invalid or expired.');
  }
}

function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    req.auth = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, jwtAccessSecret);
    if (!payload || !USER_ROLES.has(payload.role)) {
      req.auth = null;
      return next();
    }
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      tenantId: payload.tenantId,
    };
  } catch {
    req.auth = null;
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.auth?.role;
    if (!role || !roles.includes(role)) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this resource.');
    }
    return next();
  };
}

function isPlatformAdmin(auth) {
  return auth?.role === 'platform_admin';
}

function canAccessTenant(auth, tenantId) {
  if (!auth) {
    return false;
  }
  if (isPlatformAdmin(auth)) {
    return true;
  }
  return auth.tenantId === tenantId;
}

function resolveTenantId(auth, payloadTenantId) {
  if (auth) {
    if (isPlatformAdmin(auth) && isNonEmptyString(payloadTenantId)) {
      return payloadTenantId.trim();
    }
    if (isNonEmptyString(auth.tenantId)) {
      return auth.tenantId.trim();
    }
  }
  return defaultTenantId;
}

function resolvePublicTenantId(auth, requestedTenantId) {
  if (auth) {
    if (isPlatformAdmin(auth)) {
      if (isNonEmptyString(requestedTenantId)) {
        return requestedTenantId.trim();
      }
      return defaultTenantId;
    }
    if (isNonEmptyString(auth.tenantId)) {
      return auth.tenantId.trim();
    }
  }
  if (isNonEmptyString(requestedTenantId)) {
    return requestedTenantId.trim();
  }
  return defaultTenantId;
}

function getSubscription(tenantId) {
  return state.subscriptions[tenantId] || null;
}

function isTenantOperational(tenantId) {
  const subscription = getSubscription(tenantId);
  if (!subscription) {
    return false;
  }
  if (!OPERATIONAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return false;
  }
  return Number.isFinite(subscription.currentPeriodEnd) && subscription.currentPeriodEnd >= Date.now();
}

function assertTenantOperational(res, tenantId) {
  if (isTenantOperational(tenantId)) {
    return true;
  }
  const subscription = getSubscription(tenantId);
  return sendError(
    res,
    402,
    'SUBSCRIPTION_INACTIVE',
    'Tenant subscription is not active for processing orders.',
    {
      tenantId,
      subscriptionStatus: subscription?.status || 'missing',
      currentPeriodEnd: subscription?.currentPeriodEnd || null,
    }
  );
}

function createSubscriptionRecord({ tenantId, plan, status, startAt }) {
  const now = Date.now();
  const safeStartAt = Number.isFinite(startAt) ? Number(startAt) : now;
  const selectedPlan = PLAN_CATALOG[plan] || PLAN_CATALOG.monthly;
  return {
    tenantId,
    plan: selectedPlan.plan,
    status,
    amount: selectedPlan.amount,
    currency: selectedPlan.currency,
    startAt: safeStartAt,
    currentPeriodStart: safeStartAt,
    currentPeriodEnd: safeStartAt + selectedPlan.durationDays * 24 * 60 * 60 * 1000,
    updatedAt: now,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    {
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
    jwtAccessSecret,
    {
      expiresIn: jwtAccessTtl,
      subject: user.userId,
    }
  );
}

function issueRefreshToken(user) {
  const token = `rt_${crypto.randomBytes(32).toString('hex')}`;
  const now = Date.now();
  const expiresAt = now + refreshTokenTtlDays * 24 * 60 * 60 * 1000;

  state.refreshTokens[token] = {
    userId: user.userId,
    tenantId: user.tenantId,
    createdAt: now,
    expiresAt,
  };
  persistRefreshTokens();

  return token;
}

function revokeRefreshToken(token) {
  if (!state.refreshTokens[token]) {
    return;
  }
  delete state.refreshTokens[token];
  persistRefreshTokens();
}

function revokeRefreshTokensByUser(userId) {
  let hasChanges = false;
  for (const [token, value] of Object.entries(state.refreshTokens)) {
    if (value.userId === userId) {
      delete state.refreshTokens[token];
      hasChanges = true;
    }
  }
  if (hasChanges) {
    persistRefreshTokens();
  }
}

function pruneExpiredRefreshTokens() {
  let hasChanges = false;
  const now = Date.now();
  for (const [token, value] of Object.entries(state.refreshTokens)) {
    if (!value || value.expiresAt <= now) {
      delete state.refreshTokens[token];
      hasChanges = true;
    }
  }
  if (hasChanges) {
    persistRefreshTokens();
  }
}

function publicUser(user) {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  };
}

function validateOrderPayload(payload) {
  if (!isNonEmptyString(payload.orderId)) {
    return { ok: false, message: 'orderId is required.' };
  }
  if (!payload.customer || !isNonEmptyString(payload.customer.name) || !isNonEmptyString(payload.customer.phone)) {
    return { ok: false, message: 'customer.name and customer.phone are required.' };
  }
  if (!payload.address || !isNonEmptyString(payload.address.line1) || !isNonEmptyString(payload.address.city)) {
    return { ok: false, message: 'address.line1 and address.city are required.' };
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, message: 'items must be a non-empty array.' };
  }
  if (!payload.totals || !isPositiveOrZeroNumber(payload.totals.grandTotal)) {
    return { ok: false, message: 'totals.grandTotal is required.' };
  }
  if (payload.tenantId && !isNonEmptyString(payload.tenantId)) {
    return { ok: false, message: 'tenantId must be a non-empty string when provided.' };
  }
  if (payload.deliveryFeeMode && !DELIVERY_FEE_MODES.has(payload.deliveryFeeMode)) {
    return {
      ok: false,
      message: 'deliveryFeeMode must be prepaid, collect_at_drop, or restaurant_settled.',
    };
  }
  if (
    payload.deliveryFeeSettlementStatus &&
    !DELIVERY_SETTLEMENT_STATUSES.has(payload.deliveryFeeSettlementStatus)
  ) {
    return { ok: false, message: 'Invalid deliveryFeeSettlementStatus.' };
  }
  if (!['razorpay', 'whatsapp'].includes(payload.paymentMethod)) {
    return { ok: false, message: 'paymentMethod must be razorpay or whatsapp.' };
  }
  if (!isNonEmptyString(payload.paymentReference)) {
    return { ok: false, message: 'paymentReference is required.' };
  }
  return { ok: true };
}

function upsertTrackingFromOrderStatus(order) {
  const existing = state.tracking[order.orderId];
  const now = Date.now();

  let deliveryStatus = null;
  if (order.status === 'confirmed') {
    deliveryStatus = 'assigned';
  } else if (order.status === 'preparing') {
    deliveryStatus = 'picked_up';
  } else if (order.status === 'out_for_delivery') {
    deliveryStatus = 'on_the_way';
  } else if (order.status === 'delivered') {
    deliveryStatus = 'delivered';
  }

  if (!deliveryStatus) {
    return;
  }

  if (!existing) {
    state.tracking[order.orderId] = createInitialTracking(order, deliveryStatus);
    persistTracking();
    return;
  }

  const hasStatusEvent = existing.events[existing.events.length - 1]?.status === deliveryStatus;
  const events = hasStatusEvent
    ? existing.events
    : [...existing.events, { status: deliveryStatus, label: deliveryStatusLabel(deliveryStatus), time: now }];

  state.tracking[order.orderId] = {
    ...existing,
    status: deliveryStatus,
    etaMinutes: deliveryStatus === 'delivered' ? 0 : existing.etaMinutes,
    updatedAt: now,
    events,
  };
  persistTracking();
}

function createInitialTracking(order, initialStatus = 'assigned') {
  const cityPoint = resolveCityPoint(order.address.city);
  const now = Date.now();
  const agent = pickAgent();

  return {
    orderId: order.orderId,
    tenantId: order.tenantId || defaultTenantId,
    status: initialStatus,
    agentName: agent.name,
    agentPhone: agent.phone,
    etaMinutes: initialStatus === 'delivered' ? 0 : 32,
    current: {
      lat: round(cityPoint.lat + randomOffset(0.02)),
      lng: round(cityPoint.lng + randomOffset(0.02)),
    },
    events: [
      {
        status: initialStatus,
        label: deliveryStatusLabel(initialStatus),
        time: now,
      },
    ],
    updatedAt: now,
  };
}

function resolveCityPoint(city) {
  const lookup = {
    hyderabad: { lat: 17.385, lng: 78.4867 },
    bengaluru: { lat: 12.9716, lng: 77.5946 },
    bangalore: { lat: 12.9716, lng: 77.5946 },
    chennai: { lat: 13.0827, lng: 80.2707 },
    mumbai: { lat: 19.076, lng: 72.8777 },
    delhi: { lat: 28.6139, lng: 77.209 },
  };
  const key = String(city || '').trim().toLowerCase();
  return lookup[key] || lookup.hyderabad;
}

function pickAgent() {
  const agents = [
    { name: 'Ravi Kumar', phone: '+91 90000 10021' },
    { name: 'Sneha Reddy', phone: '+91 90000 10022' },
    { name: 'Arjun Patel', phone: '+91 90000 10023' },
    { name: 'Aisha Khan', phone: '+91 90000 10024' },
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

function deliveryStatusLabel(status) {
  const labels = {
    assigned: 'Delivery agent assigned',
    picked_up: 'Order picked up from kitchen',
    on_the_way: 'Rider is on the way',
    nearby: 'Rider is near your location',
    delivered: 'Order delivered',
  };
  return labels[status] || 'Tracking update';
}

function parseOptionalTime(input) {
  if (!isNonEmptyString(input)) {
    return null;
  }
  const parsed = new Date(input).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toOptionalInt(input, fallback) {
  if (!isNonEmptyString(input)) {
    return fallback;
  }
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sendError(res, status, code, message, details = {}) {
  return res.status(status).json({ code, message, details });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function isPositiveOrZeroNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeLast10(value) {
  const normalized = normalizePhone(value);
  return normalized.length <= 10 ? normalized : normalized.slice(-10);
}

function generateNumericOtp() {
  return `${Math.floor(1000 + Math.random() * 9000)}`;
}

function pruneExpiredCustomerLookupOtps() {
  let changed = false;
  const now = Date.now();
  for (const [requestId, record] of Object.entries(state.customerLookupOtp)) {
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      delete state.customerLookupOtp[requestId];
      changed = true;
    }
  }
  if (changed) {
    persistCustomerLookupOtp();
  }
}

function randomOffset(maxDelta) {
  return (Math.random() * 2 - 1) * maxDelta;
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

function persistOrders() {
  schedulePersist('orders', syncOrdersToDb);
}

function persistPaymentOrders() {
  schedulePersist('payment_orders', syncPaymentOrdersToDb);
}

function persistTracking() {
  schedulePersist('tracking', syncTrackingToDb);
}

function persistNotifications() {
  schedulePersist('notifications', syncNotificationsToDb);
}

function persistRefreshTokens() {
  schedulePersist('refresh_tokens', syncRefreshTokensToDb);
}

function persistTenants() {
  schedulePersist('tenants', syncTenantsToDb);
}

function persistSubscriptions() {
  schedulePersist('subscriptions', syncSubscriptionsToDb);
}

function persistCustomerLookupOtp() {
  schedulePersist('customer_lookup_otp', syncCustomerLookupOtpToDb);
}

function schedulePersist(taskName, task) {
  persistQueue = persistQueue
    .then(() => task())
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(`[persistence:${taskName}]`, error);
    });
}

async function loadPersistedState() {
  const [
    orderRows,
    paymentRows,
    trackingRows,
    notificationRows,
    refreshRows,
    tenantRows,
    subscriptionRows,
    otpRows,
  ] = await Promise.all([
    prisma.order.findMany(),
    prisma.paymentOrder.findMany(),
    prisma.tracking.findMany(),
    prisma.notification.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.refreshToken.findMany(),
    prisma.tenant.findMany(),
    prisma.subscription.findMany(),
    prisma.customerLookupOtp.findMany(),
  ]);

  state.orders = {};
  for (const row of orderRows) {
    const payload = asPlainObject(row.payload);
    state.orders[row.orderId] = {
      ...payload,
      orderId: row.orderId,
      tenantId: row.tenantId,
      status: row.status,
      createdAt: toEpochMs(row.createdAt),
      updatedAt: toEpochMs(row.updatedAt),
    };
  }

  state.paymentOrders = {};
  for (const row of paymentRows) {
    const payload = asPlainObject(row.payload);
    state.paymentOrders[row.providerOrderId] = {
      ...payload,
      orderReference: row.orderReference,
      amount: row.amount,
      currency: row.currency,
      createdAt: toEpochMs(row.createdAt),
    };
  }

  state.tracking = {};
  for (const row of trackingRows) {
    const payload = asPlainObject(row.payload);
    state.tracking[row.orderId] = {
      ...payload,
      orderId: row.orderId,
      tenantId: row.tenantId,
      status: row.status,
      etaMinutes: row.etaMinutes,
      updatedAt: toEpochMs(row.updatedAt),
    };
  }

  state.notifications = notificationRows.map((row) => ({
    ...asPlainObject(row.payload),
    createdAt: toEpochMs(row.createdAt),
  }));

  state.refreshTokens = {};
  for (const row of refreshRows) {
    state.refreshTokens[row.token] = {
      userId: row.userId,
      tenantId: row.tenantId,
      createdAt: toEpochMs(row.createdAt),
      expiresAt: toEpochMs(row.expiresAt),
    };
  }

  state.tenants = {};
  for (const row of tenantRows) {
    state.tenants[row.tenantId] = {
      tenantId: row.tenantId,
      name: row.name,
      createdAt: toEpochMs(row.createdAt),
      updatedAt: toEpochMs(row.updatedAt),
    };
  }

  state.subscriptions = {};
  for (const row of subscriptionRows) {
    state.subscriptions[row.tenantId] = {
      tenantId: row.tenantId,
      plan: row.plan,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      startAt: toEpochMs(row.startAt),
      currentPeriodStart: toEpochMs(row.currentPeriodStart),
      currentPeriodEnd: toEpochMs(row.currentPeriodEnd),
      updatedAt: toEpochMs(row.updatedAt),
    };
  }

  state.customerLookupOtp = {};
  for (const row of otpRows) {
    state.customerLookupOtp[row.requestId] = {
      requestId: row.requestId,
      phone: row.phone,
      tenantId: row.tenantId,
      otpCode: row.otpCode,
      attempts: row.attempts,
      createdAt: toEpochMs(row.createdAt),
      expiresAt: toEpochMs(row.expiresAt),
    };
  }
}

async function syncOrdersToDb() {
  const ids = Object.keys(state.orders);
  await syncMapIds({
    ids,
    loadExistingIds: async () => (await prisma.order.findMany({ select: { orderId: true } })).map((x) => x.orderId),
    deleteMissing: async (deleteIds) => prisma.order.deleteMany({ where: { orderId: { in: deleteIds } } }),
  });
  for (const [orderId, order] of Object.entries(state.orders)) {
    const createdAt = toDate(order.createdAt);
    const updatedAt = toDate(order.updatedAt);
    await prisma.order.upsert({
      where: { orderId },
      update: {
        tenantId: order.tenantId || defaultTenantId,
        status: order.status || 'confirmed',
        createdAt,
        updatedAt,
        payload: order,
      },
      create: {
        orderId,
        tenantId: order.tenantId || defaultTenantId,
        status: order.status || 'confirmed',
        createdAt,
        updatedAt,
        payload: order,
      },
    });
  }
}

async function syncPaymentOrdersToDb() {
  const ids = Object.keys(state.paymentOrders);
  await syncMapIds({
    ids,
    loadExistingIds: async () =>
      (await prisma.paymentOrder.findMany({ select: { providerOrderId: true } })).map((x) => x.providerOrderId),
    deleteMissing: async (deleteIds) =>
      prisma.paymentOrder.deleteMany({ where: { providerOrderId: { in: deleteIds } } }),
  });

  for (const [providerOrderId, payload] of Object.entries(state.paymentOrders)) {
    await prisma.paymentOrder.upsert({
      where: { providerOrderId },
      update: {
        orderReference: payload.orderReference || '',
        amount: Math.round(payload.amount || 0),
        currency: payload.currency || 'INR',
        createdAt: toDate(payload.createdAt),
        payload,
      },
      create: {
        providerOrderId,
        orderReference: payload.orderReference || '',
        amount: Math.round(payload.amount || 0),
        currency: payload.currency || 'INR',
        createdAt: toDate(payload.createdAt),
        payload,
      },
    });
  }
}

async function syncTrackingToDb() {
  const ids = Object.keys(state.tracking);
  await syncMapIds({
    ids,
    loadExistingIds: async () => (await prisma.tracking.findMany({ select: { orderId: true } })).map((x) => x.orderId),
    deleteMissing: async (deleteIds) => prisma.tracking.deleteMany({ where: { orderId: { in: deleteIds } } }),
  });

  for (const [orderId, tracking] of Object.entries(state.tracking)) {
    await prisma.tracking.upsert({
      where: { orderId },
      update: {
        tenantId: tracking.tenantId || defaultTenantId,
        status: tracking.status || 'assigned',
        etaMinutes: Number.isFinite(tracking.etaMinutes) ? tracking.etaMinutes : 0,
        updatedAt: toDate(tracking.updatedAt),
        payload: tracking,
      },
      create: {
        orderId,
        tenantId: tracking.tenantId || defaultTenantId,
        status: tracking.status || 'assigned',
        etaMinutes: Number.isFinite(tracking.etaMinutes) ? tracking.etaMinutes : 0,
        updatedAt: toDate(tracking.updatedAt),
        payload: tracking,
      },
    });
  }
}

async function syncNotificationsToDb() {
  const notifications = Array.isArray(state.notifications) ? state.notifications : [];
  const ids = notifications.map((notification) => notificationStorageId(notification));
  await syncMapIds({
    ids,
    loadExistingIds: async () => (await prisma.notification.findMany({ select: { id: true } })).map((x) => x.id),
    deleteMissing: async (deleteIds) => prisma.notification.deleteMany({ where: { id: { in: deleteIds } } }),
  });

  for (const notification of notifications) {
    const id = notificationStorageId(notification);
    await prisma.notification.upsert({
      where: { id },
      update: {
        tenantId: notification.tenantId || defaultTenantId,
        orderId: notification.orderId || '',
        channel: notification.channel || 'whatsapp',
        createdAt: toDate(notification.createdAt),
        payload: notification,
      },
      create: {
        id,
        tenantId: notification.tenantId || defaultTenantId,
        orderId: notification.orderId || '',
        channel: notification.channel || 'whatsapp',
        createdAt: toDate(notification.createdAt),
        payload: notification,
      },
    });
  }
}

async function syncRefreshTokensToDb() {
  const ids = Object.keys(state.refreshTokens);
  await syncMapIds({
    ids,
    loadExistingIds: async () => (await prisma.refreshToken.findMany({ select: { token: true } })).map((x) => x.token),
    deleteMissing: async (deleteIds) => prisma.refreshToken.deleteMany({ where: { token: { in: deleteIds } } }),
  });

  for (const [token, payload] of Object.entries(state.refreshTokens)) {
    await prisma.refreshToken.upsert({
      where: { token },
      update: {
        userId: payload.userId || '',
        tenantId: payload.tenantId || defaultTenantId,
        createdAt: toDate(payload.createdAt),
        expiresAt: toDate(payload.expiresAt),
      },
      create: {
        token,
        userId: payload.userId || '',
        tenantId: payload.tenantId || defaultTenantId,
        createdAt: toDate(payload.createdAt),
        expiresAt: toDate(payload.expiresAt),
      },
    });
  }
}

async function syncTenantsToDb() {
  const ids = Object.keys(state.tenants);
  await syncMapIds({
    ids,
    loadExistingIds: async () => (await prisma.tenant.findMany({ select: { tenantId: true } })).map((x) => x.tenantId),
    deleteMissing: async (deleteIds) => prisma.tenant.deleteMany({ where: { tenantId: { in: deleteIds } } }),
  });

  for (const [tenantId, payload] of Object.entries(state.tenants)) {
    await prisma.tenant.upsert({
      where: { tenantId },
      update: {
        name: payload.name || inferTenantName(tenantId),
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt),
      },
      create: {
        tenantId,
        name: payload.name || inferTenantName(tenantId),
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt),
      },
    });
  }
}

async function syncSubscriptionsToDb() {
  const ids = Object.keys(state.subscriptions);
  await syncMapIds({
    ids,
    loadExistingIds: async () =>
      (await prisma.subscription.findMany({ select: { tenantId: true } })).map((x) => x.tenantId),
    deleteMissing: async (deleteIds) =>
      prisma.subscription.deleteMany({ where: { tenantId: { in: deleteIds } } }),
  });

  for (const [tenantId, payload] of Object.entries(state.subscriptions)) {
    await prisma.subscription.upsert({
      where: { tenantId },
      update: {
        plan: payload.plan || 'monthly',
        status: payload.status || 'active',
        amount: Number.isFinite(payload.amount) ? Math.round(payload.amount) : PLAN_CATALOG.monthly.amount,
        currency: payload.currency || 'INR',
        startAt: toDate(payload.startAt),
        currentPeriodStart: toDate(payload.currentPeriodStart),
        currentPeriodEnd: toDate(payload.currentPeriodEnd),
        updatedAt: toDate(payload.updatedAt),
      },
      create: {
        tenantId,
        plan: payload.plan || 'monthly',
        status: payload.status || 'active',
        amount: Number.isFinite(payload.amount) ? Math.round(payload.amount) : PLAN_CATALOG.monthly.amount,
        currency: payload.currency || 'INR',
        startAt: toDate(payload.startAt),
        currentPeriodStart: toDate(payload.currentPeriodStart),
        currentPeriodEnd: toDate(payload.currentPeriodEnd),
        updatedAt: toDate(payload.updatedAt),
      },
    });
  }
}

async function syncCustomerLookupOtpToDb() {
  const ids = Object.keys(state.customerLookupOtp);
  await syncMapIds({
    ids,
    loadExistingIds: async () =>
      (await prisma.customerLookupOtp.findMany({ select: { requestId: true } })).map((x) => x.requestId),
    deleteMissing: async (deleteIds) =>
      prisma.customerLookupOtp.deleteMany({ where: { requestId: { in: deleteIds } } }),
  });

  for (const [requestId, payload] of Object.entries(state.customerLookupOtp)) {
    await prisma.customerLookupOtp.upsert({
      where: { requestId },
      update: {
        phone: payload.phone || '',
        tenantId: payload.tenantId || defaultTenantId,
        otpCode: payload.otpCode || '',
        attempts: Number.isFinite(payload.attempts) ? payload.attempts : 0,
        createdAt: toDate(payload.createdAt),
        expiresAt: toDate(payload.expiresAt),
      },
      create: {
        requestId,
        phone: payload.phone || '',
        tenantId: payload.tenantId || defaultTenantId,
        otpCode: payload.otpCode || '',
        attempts: Number.isFinite(payload.attempts) ? payload.attempts : 0,
        createdAt: toDate(payload.createdAt),
        expiresAt: toDate(payload.expiresAt),
      },
    });
  }
}

async function syncMapIds({ ids, loadExistingIds, deleteMissing }) {
  const existingIds = await loadExistingIds();
  if (!existingIds.length) {
    return;
  }
  const idSet = new Set(ids);
  const deleteIds = existingIds.filter((id) => !idSet.has(id));
  if (deleteIds.length > 0) {
    await deleteMissing(deleteIds);
  }
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

function toEpochMs(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function notificationStorageId(notification) {
  const seed = `${notification.orderId || ''}|${notification.providerMessageId || ''}|${
    notification.customerPhone || ''
  }|${notification.createdAt || 0}|${notification.message || ''}`;
  return crypto.createHash('sha1').update(seed).digest('hex');
}

function normalizeTenantState() {
  let ordersChanged = false;
  for (const [orderId, order] of Object.entries(state.orders)) {
    if (!isNonEmptyString(order?.tenantId)) {
      const nextTenantId = defaultTenantId;
      state.orders[orderId] = {
        ...order,
        tenantId: nextTenantId,
      };
      ordersChanged = true;
    }
  }

  let trackingChanged = false;
  for (const [orderId, tracking] of Object.entries(state.tracking)) {
    if (!tracking) {
      continue;
    }
    const tenantFromOrder = state.orders[orderId]?.tenantId || defaultTenantId;
    if (!isNonEmptyString(tracking.tenantId) || tracking.tenantId !== tenantFromOrder) {
      state.tracking[orderId] = {
        ...tracking,
        tenantId: tenantFromOrder,
      };
      trackingChanged = true;
    }
  }

  if (ordersChanged) {
    persistOrders();
  }
  if (trackingChanged) {
    persistTracking();
  }
}

function normalizeSubscriptionState() {
  const now = Date.now();
  const discoveredTenantIds = new Set();

  for (const tenantId of Object.keys(state.tenants)) {
    if (isNonEmptyString(tenantId)) {
      discoveredTenantIds.add(tenantId);
    }
  }
  for (const user of AUTH_USERS) {
    if (isNonEmptyString(user.tenantId)) {
      discoveredTenantIds.add(user.tenantId);
    }
  }
  for (const order of Object.values(state.orders)) {
    if (isNonEmptyString(order?.tenantId)) {
      discoveredTenantIds.add(order.tenantId);
    }
  }
  for (const tracking of Object.values(state.tracking)) {
    if (isNonEmptyString(tracking?.tenantId)) {
      discoveredTenantIds.add(tracking.tenantId);
    }
  }
  discoveredTenantIds.add(defaultTenantId);

  let tenantChanged = false;
  for (const tenantId of discoveredTenantIds) {
    if (!state.tenants[tenantId]) {
      state.tenants[tenantId] = {
        tenantId,
        name: inferTenantName(tenantId),
        createdAt: now,
        updatedAt: now,
      };
      tenantChanged = true;
    }
  }

  let subscriptionChanged = false;
  for (const tenantId of discoveredTenantIds) {
    const existing = state.subscriptions[tenantId];
    if (!existing) {
      state.subscriptions[tenantId] = createSubscriptionRecord({
        tenantId,
        plan: 'monthly',
        status: 'active',
        startAt: now - 7 * 24 * 60 * 60 * 1000,
      });
      subscriptionChanged = true;
      continue;
    }

    const safePlan = SUBSCRIPTION_PLANS.has(existing.plan) ? existing.plan : 'monthly';
    const safeStatus = SUBSCRIPTION_STATUSES.has(existing.status) ? existing.status : 'active';
    const startAt = Number.isFinite(existing.startAt) ? existing.startAt : now;
    const selectedPlan = PLAN_CATALOG[safePlan];
    const normalized = {
      ...existing,
      tenantId,
      plan: safePlan,
      status: safeStatus,
      amount: Number.isFinite(existing.amount) ? existing.amount : selectedPlan.amount,
      currency: isNonEmptyString(existing.currency) ? existing.currency : selectedPlan.currency,
      startAt,
      currentPeriodStart: Number.isFinite(existing.currentPeriodStart)
        ? existing.currentPeriodStart
        : startAt,
      currentPeriodEnd: Number.isFinite(existing.currentPeriodEnd)
        ? existing.currentPeriodEnd
        : startAt + selectedPlan.durationDays * 24 * 60 * 60 * 1000,
      updatedAt: Number.isFinite(existing.updatedAt) ? existing.updatedAt : now,
    };

    if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
      state.subscriptions[tenantId] = normalized;
      subscriptionChanged = true;
    }
  }

  if (tenantChanged) {
    persistTenants();
  }
  if (subscriptionChanged) {
    persistSubscriptions();
  }
}

function inferTenantName(tenantId) {
  const owner = AUTH_USERS.find((user) => user.tenantId === tenantId);
  if (owner && isNonEmptyString(owner.name)) {
    return `${owner.name} Tenant`;
  }
  const normalized = tenantId
    .split('-')
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
  return normalized || 'Green Spoon Tenant';
}

function defaultSettlementStatus(mode) {
  if (mode === 'collect_at_drop') {
    return 'pending_collection';
  }
  if (mode === 'restaurant_settled') {
    return 'restaurant_settled';
  }
  return 'not_applicable';
}

function startTrackingSimulation() {
  setInterval(() => {
    let hasTrackingChanges = false;
    let hasOrderChanges = false;

    for (const [orderId, tracking] of Object.entries(state.tracking)) {
      if (!tracking || tracking.status === 'delivered') {
        continue;
      }

      const destination = resolveCityPoint(state.orders[orderId]?.address?.city || 'hyderabad');
      const currentEta = Number.isFinite(tracking.etaMinutes) ? tracking.etaMinutes : 32;
      const nextEta = Math.max(0, currentEta - 4);
      const nextStatus = resolveSimulatedStatus(tracking.status, nextEta);
      const moved = moveToward(tracking.current, destination, 0.22);
      const now = Date.now();

      const hasStatusEvent = tracking.events[tracking.events.length - 1]?.status === nextStatus;
      const events = hasStatusEvent
        ? tracking.events
        : [
            ...tracking.events,
            {
              status: nextStatus,
              label: deliveryStatusLabel(nextStatus),
              time: now,
            },
          ];

      state.tracking[orderId] = {
        ...tracking,
        status: nextStatus,
        etaMinutes: nextEta,
        current: moved,
        events,
        updatedAt: now,
      };
      hasTrackingChanges = true;

      const order = state.orders[orderId];
      if (order) {
        const mappedOrderStatus = mapDeliveryToOrderStatus(nextStatus);
        if (mappedOrderStatus && order.status !== mappedOrderStatus) {
          state.orders[orderId] = {
            ...order,
            status: mappedOrderStatus,
            updatedAt: now,
          };
          hasOrderChanges = true;
        }
      }
    }

    if (hasTrackingChanges) {
      persistTracking();
    }
    if (hasOrderChanges) {
      persistOrders();
    }
  }, 10000);
}

function resolveSimulatedStatus(currentStatus, etaMinutes) {
  if (currentStatus === 'assigned') {
    return 'picked_up';
  }
  if (currentStatus === 'picked_up') {
    return 'on_the_way';
  }
  if (currentStatus === 'on_the_way') {
    return etaMinutes <= 8 ? 'nearby' : 'on_the_way';
  }
  if (currentStatus === 'nearby') {
    return 'nearby';
  }
  return currentStatus;
}

function mapDeliveryToOrderStatus(deliveryStatus) {
  const mapping = {
    assigned: 'confirmed',
    picked_up: 'preparing',
    on_the_way: 'out_for_delivery',
    nearby: 'out_for_delivery',
    delivered: 'delivered',
  };
  return mapping[deliveryStatus] || null;
}

function moveToward(origin, target, ratio) {
  const safeOrigin = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
    ? origin
    : target;
  return {
    lat: round(safeOrigin.lat + (target.lat - safeOrigin.lat) * ratio),
    lng: round(safeOrigin.lng + (target.lng - safeOrigin.lng) * ratio),
  };
}

async function bootstrap() {
  try {
    await prisma.$connect();
    await loadPersistedState();
    normalizeTenantState();
    normalizeSubscriptionState();
    pruneExpiredCustomerLookupOtps();
    startTrackingSimulation();

    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Green Spoon backend running at http://localhost:${port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to bootstrap Green Spoon backend.', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

void bootstrap();

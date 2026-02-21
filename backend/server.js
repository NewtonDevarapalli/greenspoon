const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('./src/observability/logger');
const { createMetrics } = require('./src/observability/metrics');
const { requestIdMiddleware } = require('./src/observability/request-id');
const { createErrorSink } = require('./src/observability/error-sink');
const { createAuthHandlers } = require('./src/modules/auth/auth.routes');
const { createUsersHandlers } = require('./src/modules/users/users.routes');
const { createTenantsHandlers } = require('./src/modules/tenants/tenants.routes');
const { createOrdersHandlers } = require('./src/modules/orders/orders.routes');
const { createPaymentsHandlers } = require('./src/modules/payments/payments.routes');
const { createTrackingHandlers } = require('./src/modules/tracking/tracking.routes');
const { createNotificationsHandlers } = require('./src/modules/notifications/notifications.routes');
const { createRestaurantsHandlers } = require('./src/modules/restaurants/restaurants.routes');
const { createMenuHandlers } = require('./src/modules/menu/menu.routes');
const { createUploadsHandlers } = require('./src/modules/uploads/uploads.routes');

const app = express();
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN;
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_replace_with_your_key';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
const jwtAccessSecret =
  process.env.JWT_ACCESS_SECRET || 'greenspoon_dev_access_secret_change_me';
const jwtAccessTtl = process.env.JWT_ACCESS_TTL || '15m';
const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'greenspoon-demo-tenant';
const authPasswordHashRounds = toSafeInt(process.env.AUTH_PASSWORD_HASH_ROUNDS, 12, 8, 14);
const authMaxFailedAttempts = toSafeInt(process.env.AUTH_MAX_FAILED_ATTEMPTS, 5, 3, 10);
const authLockoutMs = toSafeInt(process.env.AUTH_LOCKOUT_MS, 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
const authLoginRateWindowMs = toSafeInt(
  process.env.AUTH_LOGIN_RATE_WINDOW_MS,
  15 * 60 * 1000,
  60 * 1000,
  24 * 60 * 60 * 1000
);
const authLoginRateMaxAttempts = toSafeInt(process.env.AUTH_LOGIN_RATE_MAX_ATTEMPTS, 15, 5, 500);
const prisma = new PrismaClient();
const { logger, httpLogger } = createLogger();
const metrics = createMetrics();
const errorSink = createErrorSink({ logger, metrics });

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
const enableTrackingSimulation = process.env.ENABLE_TRACKING_SIMULATION === 'true';
const uploadRootDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const uploadMaxFileSizeBytes = toSafeInt(process.env.UPLOAD_MAX_FILE_SIZE_MB, 5, 1, 20) * 1024 * 1024;
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
const MASTER_DATA_ADMIN_ROLES = ['platform_admin'];
const menuUploadDir = path.join(uploadRootDir, 'menu');
fs.mkdirSync(menuUploadDir, { recursive: true });
const menuUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, menuUploadDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      callback(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${extension}`);
    },
  }),
  limits: {
    fileSize: uploadMaxFileSizeBytes,
  },
  fileFilter: (_req, file, callback) => {
    if (String(file.mimetype || '').startsWith('image/')) {
      callback(null, true);
      return;
    }
    callback(new Error('Only image uploads are allowed.'));
  },
});

app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(metrics.middleware);
app.use(cors(buildCorsOptions(corsOrigin)));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadRootDir));

const state = {
  orders: {},
  paymentOrders: {},
  tracking: {},
  notifications: [],
  refreshTokens: {},
  authUsers: [],
  tenants: {},
  subscriptions: {},
  customerLookupOtp: {},
  restaurants: {},
  menuItems: {},
};
let persistQueue = Promise.resolve();
const loginRateLimiter = rateLimit({
  windowMs: authLoginRateWindowMs,
  limit: authLoginRateMaxAttempts,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    sendError(
      res,
      429,
      'TOO_MANY_LOGIN_ATTEMPTS',
      'Too many login attempts. Please wait and try again.'
    ),
});

const authHandlers = createAuthHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  findAuthUserByEmail,
  findAuthUserById,
  isUserLocked,
  verifyAuthPassword,
  recordFailedLogin,
  resetLoginFailures,
  signAccessToken,
  issueRefreshToken,
  jwtAccessTtl,
  publicUser,
  pruneExpiredRefreshTokens,
  findRefreshTokenRecord,
  revokeRefreshToken,
  revokeRefreshTokensByUser,
  hashRefreshToken,
  audit: writeAuditLog,
});

const usersHandlers = createUsersHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  USER_ROLES,
  findAuthUserByEmail,
  findAuthUserById,
  validatePasswordStrength,
  hashPassword,
  tenantExists,
  persistAuthUsers,
  updateAuthUser,
  publicAuthUser,
  revokeRefreshTokensByUser,
  audit: writeAuditLog,
});

const tenantsHandlers = createTenantsHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  PLAN_CATALOG,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
  persistTenants,
  persistSubscriptions,
  createSubscriptionRecord,
  canAccessTenant,
  audit: writeAuditLog,
});

const ordersHandlers = createOrdersHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  validateOrderPayload,
  defaultSettlementStatus,
  resolveTenantId,
  canAccessTenant,
  tenantExists,
  assertTenantOperational,
  persistOrders,
  persistTracking,
  createInitialTracking,
  normalizePhone,
  resolvePublicTenantId,
  pruneExpiredCustomerLookupOtps,
  generateNumericOtp,
  customerLookupOtpTtlMs,
  persistCustomerLookupOtp,
  includeDebugOtp,
  normalizeLast10,
  customerLookupOtpMaxAttempts,
  defaultTenantId,
  isPlatformAdmin,
  parseOptionalTime,
  toOptionalInt,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  upsertTrackingFromOrderStatus,
  deliveryStatusLabel,
  audit: writeAuditLog,
});

const paymentsHandlers = createPaymentsHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  isPositiveNumber,
  razorpayKeyId,
  razorpayKeySecret,
  persistPaymentOrders,
  audit: writeAuditLog,
});

const trackingHandlers = createTrackingHandlers({
  prisma,
  sendError,
  canAccessTenant,
  defaultTenantId,
  assertTenantOperational,
  DELIVERY_STATUSES,
  deliveryStatusLabel,
  persistTracking,
  audit: writeAuditLog,
});

const notificationsHandlers = createNotificationsHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  canAccessTenant,
  defaultTenantId,
  notificationStorageId,
  assertTenantOperational,
  persistNotifications,
  audit: writeAuditLog,
});

const restaurantsHandlers = createRestaurantsHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  defaultTenantId,
  tenantExists,
  persistRestaurants,
  audit: writeAuditLog,
});

const menuHandlers = createMenuHandlers({
  prisma,
  sendError,
  isNonEmptyString,
  defaultTenantId,
  tenantExists,
  persistMenuItems,
  audit: writeAuditLog,
});

const uploadsHandlers = createUploadsHandlers({
  sendError,
  buildPublicUrl,
  audit: writeAuditLog,
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'greenspoon-backend',
    timestamp: Date.now(),
  });
});
app.get('/metrics', metrics.handler);

app.post('/auth/login', loginRateLimiter, authHandlers.login);
app.post('/auth/refresh', authHandlers.refresh);
app.post('/auth/logout', requireAuth, authHandlers.logout);
app.get('/auth/me', requireAuth, authHandlers.me);

app.get('/admin/roles', requireAuth, requireRole(...MASTER_DATA_ADMIN_ROLES), usersHandlers.listRoles);
app.get('/admin/users', requireAuth, requireRole('platform_admin'), usersHandlers.list);
app.post('/admin/users', requireAuth, requireRole('platform_admin'), usersHandlers.create);
app.patch('/admin/users/:userId', requireAuth, requireRole('platform_admin'), usersHandlers.update);
app.delete('/admin/users/:userId', requireAuth, requireRole('platform_admin'), usersHandlers.deactivate);
app.get('/admin/audit-logs', requireAuth, requireRole('platform_admin'), async (req, res) => {
  try {
    const limit = Math.min(toOptionalInt(req.query.limit, 100), 500);
    const where = {};
    if (isNonEmptyString(req.query.actorUserId)) {
      where.actorUserId = String(req.query.actorUserId).trim();
    }
    if (isNonEmptyString(req.query.entityType)) {
      where.entityType = String(req.query.entityType).trim();
    }
    if (isNonEmptyString(req.query.tenantId)) {
      where.tenantId = String(req.query.tenantId).trim();
    }
    if (isNonEmptyString(req.query.action)) {
      where.action = String(req.query.action).trim();
    }
    if (isNonEmptyString(req.query.status)) {
      where.status = String(req.query.status).trim();
    }
    const fromTime = parseOptionalTime(req.query.from);
    const toTime = parseOptionalTime(req.query.to);
    if (fromTime !== null || toTime !== null) {
      where.createdAt = {};
      if (fromTime !== null) {
        where.createdAt.gte = new Date(fromTime);
      }
      if (toTime !== null) {
        where.createdAt.lte = new Date(toTime);
      }
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return res.status(200).json(rows.map((row) => ({ ...row, createdAt: toEpochMs(row.createdAt) })));
  } catch {
    return sendError(res, 500, 'AUDIT_LOG_READ_FAILED', 'Failed to read audit logs.');
  }
});

app.get('/subscriptions/plans', tenantsHandlers.listPlans);
app.get('/tenants', requireAuth, requireRole('platform_admin'), tenantsHandlers.listTenants);
app.post('/tenants', requireAuth, requireRole('platform_admin'), tenantsHandlers.createTenant);
app.get('/tenants/:tenantId/subscription', requireAuth, tenantsHandlers.getSubscription);
app.put(
  '/tenants/:tenantId/subscription',
  requireAuth,
  requireRole('platform_admin'),
  tenantsHandlers.replaceSubscription
);
app.patch(
  '/tenants/:tenantId/subscription/status',
  requireAuth,
  requireRole('platform_admin'),
  tenantsHandlers.patchSubscriptionStatus
);
app.get('/admin/restaurants', requireAuth, requireRole(...MASTER_DATA_ADMIN_ROLES), restaurantsHandlers.listAdmin);
app.post('/admin/restaurants', requireAuth, requireRole(...MASTER_DATA_ADMIN_ROLES), restaurantsHandlers.create);
app.patch(
  '/admin/restaurants/:restaurantId',
  requireAuth,
  requireRole(...MASTER_DATA_ADMIN_ROLES),
  restaurantsHandlers.update
);
app.get('/admin/menu-items', requireAuth, requireRole(...MASTER_DATA_ADMIN_ROLES), menuHandlers.listAdmin);
app.post('/admin/menu-items', requireAuth, requireRole(...MASTER_DATA_ADMIN_ROLES), menuHandlers.create);
app.patch(
  '/admin/menu-items/:menuItemId',
  requireAuth,
  requireRole(...MASTER_DATA_ADMIN_ROLES),
  menuHandlers.update
);
app.post(
  '/admin/uploads/menu-image',
  requireAuth,
  requireRole(...MASTER_DATA_ADMIN_ROLES),
  handleMenuImageUpload,
  uploadsHandlers.uploadMenuImage
);
app.get('/restaurants', optionalAuth, restaurantsHandlers.listPublic);
app.get('/menu-items', optionalAuth, menuHandlers.listPublic);

app.post('/payments/razorpay/order', paymentsHandlers.createRazorpayOrder);
app.post('/payments/razorpay/verify', paymentsHandlers.verifyRazorpayPayment);

app.post('/orders', optionalAuth, ordersHandlers.createOrder);
app.post('/orders/customer/request-otp', optionalAuth, ordersHandlers.requestCustomerLookupOtp);
app.post('/orders/customer/lookup', optionalAuth, ordersHandlers.lookupCustomerOrders);
app.get('/orders/:orderId', optionalAuth, ordersHandlers.getOrder);
app.get('/orders', requireAuth, requireRole(...ORDER_ADMIN_ROLES), ordersHandlers.listOrders);
app.patch('/orders/:orderId/status', requireAuth, requireRole(...STATUS_UPDATE_ROLES), ordersHandlers.updateOrderStatus);
app.post(
  '/orders/:orderId/delivery-confirmation',
  requireAuth,
  requireRole(...DELIVERY_CONFIRM_ROLES),
  ordersHandlers.confirmDelivery
);

app.get('/tracking/:orderId', optionalAuth, trackingHandlers.getTracking);

app.post(
  '/tracking/:orderId/location',
  requireAuth,
  requireRole(...TRACKING_UPDATE_ROLES),
  trackingHandlers.updateTrackingLocation
);

app.post(
  '/notifications/whatsapp/confirmation',
  requireAuth,
  requireRole(...NOTIFICATION_ROLES),
  notificationsHandlers.queueWhatsAppConfirmation
);

app.use((error, req, res, next) => {
  logger.error(
    {
      err: error,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
    },
    'unhandled_request_error'
  );
  errorSink.captureException(error, {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
  });
  if (res.headersSent) {
    return next(error);
  }
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error.');
});

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
    void (async () => {
      const authUser = await findAuthUserById(payload.sub);
      if (!authUser || !authUser.isActive) {
        sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is invalid or expired.');
        return;
      }
      req.auth = {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
        role: authUser.role,
        tenantId: authUser.tenantId,
      };
      next();
    })().catch(() => {
      sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is invalid or expired.');
    });
    return;
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
    void (async () => {
      const authUser = await findAuthUserById(payload.sub);
      if (!authUser || !authUser.isActive) {
        req.auth = null;
        next();
        return;
      }
      req.auth = {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
        role: authUser.role,
        tenantId: authUser.tenantId,
      };
      next();
    })().catch(() => {
      req.auth = null;
      next();
    });
    return;
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

function handleMenuImageUpload(req, res, next) {
  const uploader = menuUpload.single('image');
  uploader(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const details = {};
    if (error.code === 'LIMIT_FILE_SIZE') {
      details.maxMb = Math.round(uploadMaxFileSizeBytes / (1024 * 1024));
      sendError(res, 400, 'UPLOAD_TOO_LARGE', 'Uploaded image is too large.', details);
      return;
    }
    sendError(res, 400, 'UPLOAD_FAILED', error.message || 'Image upload failed.', details);
  });
}

function buildPublicUrl(req, relativePath) {
  const cleanRelativePath = `/${String(relativePath || '').replace(/^\/+/, '')}`;
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL;
  if (isNonEmptyString(configuredBaseUrl)) {
    return `${configuredBaseUrl.replace(/\/+$/, '')}${cleanRelativePath}`;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const protocol = isNonEmptyString(forwardedProto) ? forwardedProto : req.protocol || 'http';
  const host = req.get('host') || `localhost:${port}`;
  return `${protocol}://${host}${cleanRelativePath}`;
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

async function tenantExists(tenantId) {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!isNonEmptyString(normalizedTenantId)) {
    return false;
  }
  const tenant = await prisma.tenant.findUnique({
    where: { tenantId: normalizedTenantId },
    select: { tenantId: true },
  });
  return Boolean(tenant);
}

async function getSubscription(tenantId) {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!isNonEmptyString(normalizedTenantId)) {
    return null;
  }
  const row = await prisma.subscription.findUnique({ where: { tenantId: normalizedTenantId } });
  if (!row) {
    return null;
  }
  return {
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

async function isTenantOperational(tenantId) {
  const subscription = await getSubscription(tenantId);
  if (!subscription) {
    return false;
  }
  if (!OPERATIONAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return false;
  }
  return Number.isFinite(subscription.currentPeriodEnd) && subscription.currentPeriodEnd >= Date.now();
}

async function assertTenantOperational(res, tenantId) {
  if (await isTenantOperational(tenantId)) {
    return true;
  }
  const subscription = await getSubscription(tenantId);
  sendError(res, 402, 'SUBSCRIPTION_INACTIVE', 'Tenant subscription is not active for processing orders.', {
    tenantId,
    subscriptionStatus: subscription?.status || 'missing',
    currentPeriodEnd: subscription?.currentPeriodEnd || null,
  });
  return false;
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

async function issueRefreshToken(user) {
  const token = `rt_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashRefreshToken(token);
  const now = Date.now();
  const expiresAt = now + refreshTokenTtlDays * 24 * 60 * 60 * 1000;

  await prisma.refreshToken.upsert({
    where: { token: tokenHash },
    update: {
      userId: user.userId,
      tenantId: user.tenantId,
      createdAt: toDate(now),
      expiresAt: toDate(expiresAt),
    },
    create: {
      token: tokenHash,
      userId: user.userId,
      tenantId: user.tenantId,
      createdAt: toDate(now),
      expiresAt: toDate(expiresAt),
    },
  });

  return token;
}

async function revokeRefreshToken(token) {
  const tokenRecord = await findRefreshTokenRecord(token);
  if (!tokenRecord) {
    return;
  }
  await prisma.refreshToken.deleteMany({ where: { token: tokenRecord.key } });
}

async function revokeRefreshTokensByUser(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

async function pruneExpiredRefreshTokens() {
  await prisma.refreshToken.deleteMany({
    where: {
      expiresAt: {
        lte: new Date(),
      },
    },
  });
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

function buildCorsOptions(configValue) {
  const defaultOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200'];
  const rawValue = isNonEmptyString(configValue) ? configValue.trim() : '';

  if (rawValue === '*') {
    return { origin: true };
  }

  const configuredOrigins = (rawValue || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const allowedOrigins =
    configuredOrigins.length > 0
      ? [...new Set([...defaultOrigins, ...configuredOrigins])]
      : defaultOrigins;

  return {
    origin(origin, callback) {
      // Allow non-browser clients and same-origin requests.
      if (!isNonEmptyString(origin)) {
        callback(null, true);
        return;
      }

      callback(null, allowedOrigins.includes(origin));
    },
  };
}

function publicAuthUser(user) {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    isActive: user.isActive,
    failedLoginAttempts: user.failedLoginAttempts,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toAuthUserRecord(row) {
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

function getAuthUserCatalog() {
  return state.authUsers;
}

async function findAuthUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!isNonEmptyString(normalizedEmail)) {
    return null;
  }
  const row = await prisma.authUser.findUnique({ where: { email: normalizedEmail } });
  return toAuthUserRecord(row);
}

async function findAuthUserById(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!isNonEmptyString(normalizedUserId)) {
    return null;
  }
  const row = await prisma.authUser.findUnique({ where: { userId: normalizedUserId } });
  return toAuthUserRecord(row);
}

async function updateAuthUser(userId, updates) {
  const existing = await prisma.authUser.findUnique({ where: { userId } });
  if (!existing) {
    return null;
  }
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
      updatedAt: new Date(),
    },
  });
  return toAuthUserRecord(row);
}

function isUserLocked(user) {
  return Number.isFinite(user?.lockedUntil) && user.lockedUntil > Date.now();
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, authPasswordHashRounds);
}

async function verifyAuthPassword(user, plainPassword) {
  if (!isNonEmptyString(user?.passwordHash)) {
    return { valid: false };
  }

  if (user.passwordHash.startsWith('$2')) {
    const valid = await bcrypt.compare(plainPassword, user.passwordHash);
    return { valid };
  }

  // Legacy fallback for existing plaintext values; immediately upgrades to bcrypt.
  if (user.passwordHash === plainPassword) {
    const nextHash = await hashPassword(plainPassword);
    await updateAuthUser(user.userId, { passwordHash: nextHash });
    return { valid: true };
  }

  return { valid: false };
}

function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^a-zA-Z0-9]/.test(value)) {
    return {
      ok: false,
      message: 'Password must include uppercase, lowercase, number, and special character.',
    };
  }
  return { ok: true };
}

async function recordFailedLogin(userId) {
  const user = await findAuthUserById(userId);
  if (!user) {
    return { lockedUntil: null };
  }

  const nextAttempts = (Number.isFinite(user.failedLoginAttempts) ? user.failedLoginAttempts : 0) + 1;
  if (nextAttempts >= authMaxFailedAttempts) {
    const lockedUntil = Date.now() + authLockoutMs;
    await updateAuthUser(userId, {
      failedLoginAttempts: 0,
      lockedUntil,
    });
    return { lockedUntil };
  }

  await updateAuthUser(userId, {
    failedLoginAttempts: nextAttempts,
  });
  return { lockedUntil: null };
}

async function resetLoginFailures(userId) {
  const user = await findAuthUserById(userId);
  if (!user) {
    return;
  }
  await updateAuthUser(userId, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: Date.now(),
  });
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function findRefreshTokenRecord(rawToken) {
  const normalizedToken = String(rawToken || '').trim();
  if (!isNonEmptyString(normalizedToken)) {
    return null;
  }

  const hashedToken = hashRefreshToken(normalizedToken);
  let row = await prisma.refreshToken.findUnique({ where: { token: hashedToken } });
  if (!row) {
    row = await prisma.refreshToken.findUnique({ where: { token: normalizedToken } });
    if (row) {
      await prisma.refreshToken.deleteMany({ where: { token: normalizedToken } });
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

async function upsertTrackingFromOrderStatus(order) {
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

  const existingRow = await prisma.tracking.findUnique({ where: { orderId: order.orderId } });
  if (!existingRow) {
    const created = createInitialTracking(order, deliveryStatus);
    await prisma.tracking.upsert({
      where: { orderId: order.orderId },
      update: {
        tenantId: created.tenantId,
        status: created.status,
        etaMinutes: created.etaMinutes,
        updatedAt: toDate(created.updatedAt),
        payload: created,
      },
      create: {
        orderId: order.orderId,
        tenantId: created.tenantId,
        status: created.status,
        etaMinutes: created.etaMinutes,
        updatedAt: toDate(created.updatedAt),
        payload: created,
      },
    });
    return;
  }

  const existingPayload = asPlainObject(existingRow.payload);
  const existingEvents = Array.isArray(existingPayload.events) ? existingPayload.events : [];
  const hasStatusEvent = existingEvents[existingEvents.length - 1]?.status === deliveryStatus;
  const events = hasStatusEvent
    ? existingEvents
    : [...existingEvents, { status: deliveryStatus, label: deliveryStatusLabel(deliveryStatus), time: now }];

  const nextTracking = {
    ...existingPayload,
    orderId: order.orderId,
    tenantId: order.tenantId || existingRow.tenantId || defaultTenantId,
    status: deliveryStatus,
    etaMinutes: deliveryStatus === 'delivered' ? 0 : existingRow.etaMinutes,
    updatedAt: now,
    events,
  };

  await prisma.tracking.upsert({
    where: { orderId: order.orderId },
    update: {
      tenantId: nextTracking.tenantId,
      status: nextTracking.status,
      etaMinutes: Number.isFinite(nextTracking.etaMinutes) ? nextTracking.etaMinutes : 0,
      updatedAt: toDate(nextTracking.updatedAt),
      payload: nextTracking,
    },
    create: {
      orderId: order.orderId,
      tenantId: nextTracking.tenantId,
      status: nextTracking.status,
      etaMinutes: Number.isFinite(nextTracking.etaMinutes) ? nextTracking.etaMinutes : 0,
      updatedAt: toDate(nextTracking.updatedAt),
      payload: nextTracking,
    },
  });
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
  const requestId = res?.req?.id;
  if (requestId) {
    details = { ...details, requestId };
  }
  return res.status(status).json({ code, message, details });
}

function writeAuditLog(entry) {
  const now = Date.now();
  const payload = {
    id: `audit_${now}_${crypto.randomBytes(6).toString('hex')}`,
    actorUserId: isNonEmptyString(entry?.actorUserId) ? entry.actorUserId : null,
    actorEmail: isNonEmptyString(entry?.actorEmail) ? String(entry.actorEmail).toLowerCase() : null,
    action: isNonEmptyString(entry?.action) ? entry.action : 'unknown',
    entityType: isNonEmptyString(entry?.entityType) ? entry.entityType : 'unknown',
    entityId: isNonEmptyString(entry?.entityId) ? entry.entityId : null,
    tenantId: isNonEmptyString(entry?.tenantId) ? entry.tenantId : null,
    status: isNonEmptyString(entry?.status) ? entry.status : 'unknown',
    details: entry?.details && typeof entry.details === 'object' ? entry.details : {},
    createdAt: new Date(now),
  };

  prisma.auditLog.create({ data: payload }).catch((error) => {
    logger.error({ err: error, action: payload.action, entityType: payload.entityType }, 'audit_log_write_failed');
    errorSink.captureException(error, {
      action: payload.action,
      entityType: payload.entityType,
    });
  });
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

function persistAuthUsers() {
  schedulePersist('auth_users', syncAuthUsersToDb);
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

function persistRestaurants() {
  schedulePersist('restaurants', syncRestaurantsToDb);
}

function persistMenuItems() {
  schedulePersist('menu_items', syncMenuItemsToDb);
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
    authUserRows,
    orderRows,
    paymentRows,
    trackingRows,
    notificationRows,
    refreshRows,
    tenantRows,
    subscriptionRows,
    otpRows,
    restaurantRows,
    menuItemRows,
  ] = await Promise.all([
    prisma.authUser.findMany(),
    prisma.order.findMany(),
    prisma.paymentOrder.findMany(),
    prisma.tracking.findMany(),
    prisma.notification.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.refreshToken.findMany(),
    prisma.tenant.findMany(),
    prisma.subscription.findMany(),
    prisma.customerLookupOtp.findMany(),
    prisma.restaurant.findMany(),
    prisma.menuItem.findMany(),
  ]);

  state.authUsers = authUserRows
    .map((row) => {
      if (
        !isNonEmptyString(row.userId) ||
        !isNonEmptyString(row.email) ||
        !isNonEmptyString(row.passwordHash) ||
        !isNonEmptyString(row.name) ||
        !isNonEmptyString(row.role) ||
        !isNonEmptyString(row.tenantId) ||
        !USER_ROLES.has(row.role)
      ) {
        return null;
      }
      return {
        userId: row.userId,
        email: row.email.toLowerCase(),
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
    })
    .filter(Boolean);

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

  state.restaurants = {};
  for (const row of restaurantRows) {
    state.restaurants[row.restaurantId] = {
      restaurantId: row.restaurantId,
      tenantId: row.tenantId,
      name: row.name,
      city: row.city,
      isActive: row.isActive !== false,
      createdAt: toEpochMs(row.createdAt),
      updatedAt: toEpochMs(row.updatedAt),
    };
  }

  state.menuItems = {};
  for (const row of menuItemRows) {
    state.menuItems[row.menuItemId] = {
      menuItemId: row.menuItemId,
      tenantId: row.tenantId,
      restaurantId: row.restaurantId,
      name: row.name,
      category: row.category,
      description: row.description || '',
      image: row.image || '',
      price: row.price,
      calories: row.calories || '',
      isActive: row.isActive !== false,
      createdAt: toEpochMs(row.createdAt),
      updatedAt: toEpochMs(row.updatedAt),
    };
  }
}

async function syncAuthUsersToDb() {
  const ids = state.authUsers.map((user) => user.userId);
  await syncMapIds({
    ids,
    loadExistingIds: async () => (await prisma.authUser.findMany({ select: { userId: true } })).map((x) => x.userId),
    deleteMissing: async (deleteIds) => prisma.authUser.deleteMany({ where: { userId: { in: deleteIds } } }),
  });

  for (const user of state.authUsers) {
    await prisma.authUser.upsert({
      where: { userId: user.userId },
      update: {
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
      create: {
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

function toNullableDate(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value);
}

function toSafeInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, min), max);
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

  let restaurantsChanged = false;
  for (const [restaurantId, restaurant] of Object.entries(state.restaurants)) {
    if (!restaurant) {
      continue;
    }
    if (!isNonEmptyString(restaurant.tenantId)) {
      state.restaurants[restaurantId] = {
        ...restaurant,
        tenantId: defaultTenantId,
      };
      restaurantsChanged = true;
    }
  }

  let menuItemsChanged = false;
  for (const [menuItemId, menuItem] of Object.entries(state.menuItems)) {
    if (!menuItem) {
      continue;
    }
    const restaurantTenantId = state.restaurants[menuItem.restaurantId]?.tenantId;
    const nextTenantId = isNonEmptyString(restaurantTenantId)
      ? restaurantTenantId
      : isNonEmptyString(menuItem.tenantId)
      ? menuItem.tenantId
      : defaultTenantId;
    if (!isNonEmptyString(menuItem.tenantId) || menuItem.tenantId !== nextTenantId) {
      state.menuItems[menuItemId] = {
        ...menuItem,
        tenantId: nextTenantId,
      };
      menuItemsChanged = true;
    }
  }

  if (ordersChanged) {
    persistOrders();
  }
  if (trackingChanged) {
    persistTracking();
  }
  if (restaurantsChanged) {
    persistRestaurants();
  }
  if (menuItemsChanged) {
    persistMenuItems();
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
  for (const user of getAuthUserCatalog()) {
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
  for (const restaurant of Object.values(state.restaurants)) {
    if (isNonEmptyString(restaurant?.tenantId)) {
      discoveredTenantIds.add(restaurant.tenantId);
    }
  }
  for (const menuItem of Object.values(state.menuItems)) {
    if (isNonEmptyString(menuItem?.tenantId)) {
      discoveredTenantIds.add(menuItem.tenantId);
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
  const owner = getAuthUserCatalog().find((user) => user.tenantId === tenantId);
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
    if (enableTrackingSimulation) {
      startTrackingSimulation();
    }

    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Green Spoon backend running at http://localhost:${port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to bootstrap Green Spoon backend.', error);
    errorSink.captureException(error, { source: 'bootstrap' });
    process.exit(1);
  }
}

async function syncRestaurantsToDb() {
  const ids = Object.keys(state.restaurants);
  await syncMapIds({
    ids,
    loadExistingIds: async () =>
      (await prisma.restaurant.findMany({ select: { restaurantId: true } })).map((x) => x.restaurantId),
    deleteMissing: async (deleteIds) =>
      prisma.restaurant.deleteMany({ where: { restaurantId: { in: deleteIds } } }),
  });

  for (const [restaurantId, payload] of Object.entries(state.restaurants)) {
    await prisma.restaurant.upsert({
      where: { restaurantId },
      update: {
        tenantId: payload.tenantId || defaultTenantId,
        name: payload.name || restaurantId,
        city: payload.city || 'Hyderabad',
        isActive: payload.isActive !== false,
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt),
      },
      create: {
        restaurantId,
        tenantId: payload.tenantId || defaultTenantId,
        name: payload.name || restaurantId,
        city: payload.city || 'Hyderabad',
        isActive: payload.isActive !== false,
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt),
      },
    });
  }
}

async function syncMenuItemsToDb() {
  const ids = Object.keys(state.menuItems);
  await syncMapIds({
    ids,
    loadExistingIds: async () =>
      (await prisma.menuItem.findMany({ select: { menuItemId: true } })).map((x) => x.menuItemId),
    deleteMissing: async (deleteIds) => prisma.menuItem.deleteMany({ where: { menuItemId: { in: deleteIds } } }),
  });

  for (const [menuItemId, payload] of Object.entries(state.menuItems)) {
    await prisma.menuItem.upsert({
      where: { menuItemId },
      update: {
        tenantId: payload.tenantId || defaultTenantId,
        restaurantId: payload.restaurantId || '',
        name: payload.name || menuItemId,
        category: payload.category || 'General',
        description: isNonEmptyString(payload.description) ? payload.description : null,
        image: isNonEmptyString(payload.image) ? payload.image : null,
        price: Number.isFinite(payload.price) ? Math.round(payload.price) : 0,
        calories: isNonEmptyString(payload.calories) ? payload.calories : null,
        isActive: payload.isActive !== false,
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt),
      },
      create: {
        menuItemId,
        tenantId: payload.tenantId || defaultTenantId,
        restaurantId: payload.restaurantId || '',
        name: payload.name || menuItemId,
        category: payload.category || 'General',
        description: isNonEmptyString(payload.description) ? payload.description : null,
        image: isNonEmptyString(payload.image) ? payload.image : null,
        price: Number.isFinite(payload.price) ? Math.round(payload.price) : 0,
        calories: isNonEmptyString(payload.calories) ? payload.calories : null,
        isActive: payload.isActive !== false,
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt),
      },
    });
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

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled_rejection');
  errorSink.captureException(reason, { source: 'unhandledRejection' });
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught_exception');
  errorSink.captureException(error, { source: 'uncaughtException' });
});

void bootstrap();

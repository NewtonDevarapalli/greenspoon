const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || '*';
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_replace_with_your_key';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';

const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PAYMENT_ORDERS_FILE = path.join(DATA_DIR, 'payment-orders.json');
const TRACKING_FILE = path.join(DATA_DIR, 'tracking.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

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
  out_for_delivery: ['delivered'],
};

app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
app.use(express.json({ limit: '2mb' }));

const state = {
  orders: readJson(ORDERS_FILE, {}),
  paymentOrders: readJson(PAYMENT_ORDERS_FILE, {}),
  tracking: readJson(TRACKING_FILE, {}),
  notifications: readJson(NOTIFICATIONS_FILE, []),
};

startTrackingSimulation();

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'greenspoon-backend',
    timestamp: Date.now(),
  });
});

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

app.post('/orders', (req, res) => {
  const payload = req.body || {};
  const validation = validateOrderPayload(payload);
  if (!validation.ok) {
    return sendError(res, 400, 'INVALID_PAYLOAD', validation.message);
  }

  if (state.orders[payload.orderId]) {
    return sendError(res, 409, 'DUPLICATE_ORDER', 'orderId already exists.');
  }

  const now = Date.now();
  const order = {
    ...payload,
    status: 'confirmed',
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

app.get('/orders/:orderId', (req, res) => {
  const order = state.orders[req.params.orderId];
  if (!order) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
  }
  return res.status(200).json(order);
});

app.get('/orders', (req, res) => {
  let orders = Object.values(state.orders);

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

app.patch('/orders/:orderId/status', (req, res) => {
  const orderId = req.params.orderId;
  const order = state.orders[orderId];
  if (!order) {
    return sendError(res, 404, 'NOT_FOUND', 'Order not found.');
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
});

app.get('/tracking/:orderId', (req, res) => {
  const tracking = state.tracking[req.params.orderId];
  if (!tracking) {
    return sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
  }
  return res.status(200).json(tracking);
});

app.post('/tracking/:orderId/location', (req, res) => {
  const orderId = req.params.orderId;
  const tracking = state.tracking[orderId];
  if (!tracking) {
    return sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
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
});

app.post('/notifications/whatsapp/confirmation', (req, res) => {
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

  const providerMessageId = `wamid.${crypto.randomBytes(8).toString('hex')}`;
  state.notifications.push({
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
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Green Spoon backend running at http://localhost:${port}`);
});

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

function randomOffset(maxDelta) {
  return (Math.random() * 2 - 1) * maxDelta;
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

function readJson(filePath, fallback) {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function persistOrders() {
  writeJson(ORDERS_FILE, state.orders);
}

function persistPaymentOrders() {
  writeJson(PAYMENT_ORDERS_FILE, state.paymentOrders);
}

function persistTracking() {
  writeJson(TRACKING_FILE, state.tracking);
}

function persistNotifications() {
  writeJson(NOTIFICATIONS_FILE, state.notifications);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
    return etaMinutes <= 0 ? 'delivered' : 'nearby';
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

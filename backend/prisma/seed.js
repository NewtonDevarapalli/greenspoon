const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PLAN_CATALOG = {
  monthly: { durationDays: 30, amount: 4999, currency: 'INR' },
  quarterly: { durationDays: 90, amount: 13999, currency: 'INR' },
  yearly: { durationDays: 365, amount: 49999, currency: 'INR' },
};

async function main() {
  const now = Date.now();

  await upsertTenantWithSubscription({
    tenantId: 'greenspoon-platform',
    name: 'Platform Admin Tenant',
    plan: 'yearly',
    status: 'active',
    startAt: now - 15 * 24 * 60 * 60 * 1000,
  });

  await upsertTenantWithSubscription({
    tenantId: 'greenspoon-demo-tenant',
    name: 'Green Spoon Demo Tenant',
    plan: 'monthly',
    status: 'active',
    startAt: now - 7 * 24 * 60 * 60 * 1000,
  });

  await seedDemoOrders();

  // eslint-disable-next-line no-console
  console.log('Prisma seed completed.');
}

async function upsertTenantWithSubscription({ tenantId, name, plan, status, startAt }) {
  const now = Date.now();
  const config = PLAN_CATALOG[plan] || PLAN_CATALOG.monthly;
  const safeStartAt = Number.isFinite(startAt) ? startAt : now;

  await prisma.tenant.upsert({
    where: { tenantId },
    update: {
      name,
      updatedAt: new Date(now),
    },
    create: {
      tenantId,
      name,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId },
    update: {
      plan,
      status,
      amount: config.amount,
      currency: config.currency,
      startAt: new Date(safeStartAt),
      currentPeriodStart: new Date(safeStartAt),
      currentPeriodEnd: new Date(safeStartAt + config.durationDays * 24 * 60 * 60 * 1000),
      updatedAt: new Date(now),
    },
    create: {
      tenantId,
      plan,
      status,
      amount: config.amount,
      currency: config.currency,
      startAt: new Date(safeStartAt),
      currentPeriodStart: new Date(safeStartAt),
      currentPeriodEnd: new Date(safeStartAt + config.durationDays * 24 * 60 * 60 * 1000),
      updatedAt: new Date(now),
    },
  });
}

async function seedDemoOrders() {
  const now = Date.now();
  const baseCustomer = {
    name: 'Green Spoon Customer',
    phone: '9000010021',
    email: 'customer@greenspoon.com',
  };
  const baseAddress = {
    line1: 'Madhapur Street 12',
    city: 'Hyderabad',
    notes: 'Leave at gate',
  };

  const sampleOrders = [
    {
      orderId: 'GS-DEMO-1001',
      tenantId: 'greenspoon-demo-tenant',
      status: 'out_for_delivery',
      createdAt: now - 45 * 60 * 1000,
      updatedAt: now - 9 * 60 * 1000,
      customer: baseCustomer,
      address: baseAddress,
      items: [
        {
          id: 'sprouts-power-bowl',
          name: 'Power Sprouts Bowl',
          type: 'Sprouts',
          image: 'assets/images/food/sprouts-bowl.jpg',
          price: 229,
          calories: '320 kcal',
          quantity: 1,
        },
      ],
      totals: {
        subtotal: 229,
        deliveryFee: 39,
        tax: 11,
        grandTotal: 279,
        payableNow: 279,
      },
      paymentMethod: 'whatsapp',
      paymentReference: 'WA-DEMO-1001',
      deliveryFeeMode: 'prepaid',
      deliveryFeeSettlementStatus: 'not_applicable',
      deliveryConfirmation: {
        expectedOtp: '4321',
        otpVerified: false,
      },
    },
    {
      orderId: 'GS-DEMO-1002',
      tenantId: 'greenspoon-demo-tenant',
      status: 'delivered',
      createdAt: now - 4 * 60 * 60 * 1000,
      updatedAt: now - 3 * 60 * 60 * 1000,
      customer: baseCustomer,
      address: baseAddress,
      items: [
        {
          id: 'salad-zesty-quinoa',
          name: 'Zesty Quinoa Salad',
          type: 'Salads',
          image: 'assets/images/food/zesty-quinoa-salad.jpg',
          price: 249,
          calories: '280 kcal',
          quantity: 1,
        },
      ],
      totals: {
        subtotal: 249,
        deliveryFee: 39,
        tax: 12,
        grandTotal: 300,
        payableNow: 261,
        deliveryFeeDueAtDrop: 39,
      },
      paymentMethod: 'razorpay',
      paymentReference: 'pay_demo_1002',
      deliveryFeeMode: 'collect_at_drop',
      deliveryFeeSettlementStatus: 'collected',
      deliveryFeeCollection: {
        amountCollected: 39,
        method: 'cash',
        collectedAt: now - 3 * 60 * 60 * 1000,
        collectedBy: 'Dispatch Team',
        notes: 'Exact cash received',
      },
      deliveryConfirmation: {
        expectedOtp: '5678',
        receivedOtp: '5678',
        otpVerified: true,
        proofNote: 'Delivered at doorstep',
        deliveredAt: now - 3 * 60 * 60 * 1000,
        confirmedBy: 'Dispatch Team',
      },
    },
  ];

  for (const order of sampleOrders) {
    const payload = { ...order };
    await prisma.order.upsert({
      where: { orderId: order.orderId },
      update: {
        tenantId: order.tenantId,
        status: order.status,
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt),
        payload,
      },
      create: {
        orderId: order.orderId,
        tenantId: order.tenantId,
        status: order.status,
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt),
        payload,
      },
    });

    await prisma.tracking.upsert({
      where: { orderId: order.orderId },
      update: buildTrackingRecord(order, now),
      create: {
        orderId: order.orderId,
        ...buildTrackingRecord(order, now),
      },
    });
  }
}

function buildTrackingRecord(order, now) {
  const isDelivered = order.status === 'delivered';
  const current = isDelivered ? { lat: 17.385, lng: 78.4867 } : { lat: 17.4012, lng: 78.4921 };
  const events = isDelivered
    ? [
        { status: 'assigned', label: 'Delivery agent assigned', time: order.createdAt + 3 * 60 * 1000 },
        { status: 'picked_up', label: 'Order picked up from kitchen', time: order.createdAt + 18 * 60 * 1000 },
        { status: 'on_the_way', label: 'Rider is on the way', time: order.createdAt + 34 * 60 * 1000 },
        { status: 'delivered', label: 'Order delivered', time: order.updatedAt },
      ]
    : [
        { status: 'assigned', label: 'Delivery agent assigned', time: order.createdAt + 4 * 60 * 1000 },
        { status: 'picked_up', label: 'Order picked up from kitchen', time: order.createdAt + 16 * 60 * 1000 },
        { status: 'on_the_way', label: 'Rider is on the way', time: order.updatedAt - 5 * 60 * 1000 },
      ];

  return {
    tenantId: order.tenantId,
    status: isDelivered ? 'delivered' : 'on_the_way',
    etaMinutes: isDelivered ? 0 : 9,
    updatedAt: new Date(order.updatedAt || now),
    payload: {
      orderId: order.orderId,
      tenantId: order.tenantId,
      status: isDelivered ? 'delivered' : 'on_the_way',
      agentName: 'Ravi Kumar',
      agentPhone: '+91 90000 10021',
      etaMinutes: isDelivered ? 0 : 9,
      current,
      events,
      updatedAt: order.updatedAt || now,
    },
  };
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Prisma seed failed.', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const passwordHashRounds = Number(process.env.AUTH_PASSWORD_HASH_ROUNDS || 12);

const PLAN_CATALOG = {
  monthly: { durationDays: 30, amount: 4999, currency: 'INR' },
  quarterly: { durationDays: 90, amount: 13999, currency: 'INR' },
  yearly: { durationDays: 365, amount: 49999, currency: 'INR' },
};

const DEMO_AUTH_USERS = [
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

async function main() {
  const now = Date.now();
  await seedAuthUsers(now);

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

  await seedRestaurantsAndMenu(now);
  await seedDemoOrders();

  // eslint-disable-next-line no-console
  console.log('Prisma seed completed.');
}

async function seedAuthUsers(now) {
  const rounds = Number.isFinite(passwordHashRounds)
    ? Math.min(Math.max(Math.floor(passwordHashRounds), 8), 14)
    : 12;

  for (const user of DEMO_AUTH_USERS) {
    const passwordHash = await bcrypt.hash(user.password, rounds);
    await prisma.authUser.upsert({
      where: { userId: user.userId },
      update: {
        email: user.email.toLowerCase(),
        passwordHash,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(now),
      },
      create: {
        userId: user.userId,
        email: user.email.toLowerCase(),
        passwordHash,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
  }
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

async function seedRestaurantsAndMenu(now) {
  const restaurants = [
    {
      restaurantId: 'rest-gs-hyd-main',
      tenantId: 'greenspoon-demo-tenant',
      name: 'Green Spoon Hyderabad Main',
      city: 'Hyderabad',
      isActive: true,
    },
    {
      restaurantId: 'rest-gs-hyd-cloud',
      tenantId: 'greenspoon-demo-tenant',
      name: 'Green Spoon Hyderabad Cloud Hub',
      city: 'Hyderabad',
      isActive: true,
    },
  ];

  for (const restaurant of restaurants) {
    await prisma.restaurant.upsert({
      where: { restaurantId: restaurant.restaurantId },
      update: {
        tenantId: restaurant.tenantId,
        name: restaurant.name,
        city: restaurant.city,
        isActive: restaurant.isActive,
        updatedAt: new Date(now),
      },
      create: {
        restaurantId: restaurant.restaurantId,
        tenantId: restaurant.tenantId,
        name: restaurant.name,
        city: restaurant.city,
        isActive: restaurant.isActive,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
  }

  const menuItems = [
    {
      menuItemId: 'menu-power-sprouts-bowl',
      tenantId: 'greenspoon-demo-tenant',
      restaurantId: 'rest-gs-hyd-main',
      name: 'Power Sprouts Bowl',
      category: 'Sprouts',
      description: 'Protein rich sprouts bowl with crunchy seeds.',
      image: 'images/food4.png',
      price: 219,
      calories: '320 kcal',
      isActive: true,
    },
    {
      menuItemId: 'menu-zesty-quinoa-salad',
      tenantId: 'greenspoon-demo-tenant',
      restaurantId: 'rest-gs-hyd-main',
      name: 'Zesty Quinoa Salad',
      category: 'Salads',
      description: 'Quinoa, greens, and citrus dressing.',
      image: 'images/food2.png',
      price: 249,
      calories: '280 kcal',
      isActive: true,
    },
    {
      menuItemId: 'menu-cucumber-mint-cooler',
      tenantId: 'greenspoon-demo-tenant',
      restaurantId: 'rest-gs-hyd-cloud',
      name: 'Cucumber Mint Cooler',
      category: 'Better Water',
      description: 'Infused hydration with cucumber and mint.',
      image: 'images/food1.png',
      price: 99,
      calories: '30 kcal',
      isActive: true,
    },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { menuItemId: item.menuItemId },
      update: {
        tenantId: item.tenantId,
        restaurantId: item.restaurantId,
        name: item.name,
        category: item.category,
        description: item.description,
        image: item.image,
        price: item.price,
        calories: item.calories,
        isActive: item.isActive,
        updatedAt: new Date(now),
      },
      create: {
        menuItemId: item.menuItemId,
        tenantId: item.tenantId,
        restaurantId: item.restaurantId,
        name: item.name,
        category: item.category,
        description: item.description,
        image: item.image,
        price: item.price,
        calories: item.calories,
        isActive: item.isActive,
        createdAt: new Date(now),
        updatedAt: new Date(now),
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

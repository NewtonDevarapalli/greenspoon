function createOrdersService(deps) {
  const repo = deps.repository;

  async function createOrder(req, res) {
    const payload = req.body || {};
    const validation = deps.validateOrderPayload(payload);
    if (!validation.ok) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', validation.message);
    }

    if (await repo.getOrder(payload.orderId)) {
      return deps.sendError(res, 409, 'DUPLICATE_ORDER', 'orderId already exists.');
    }

    const now = Date.now();
    const deliveryFeeMode = payload.deliveryFeeMode || 'prepaid';
    const deliveryFeeSettlementStatus =
      payload.deliveryFeeSettlementStatus || deps.defaultSettlementStatus(deliveryFeeMode);
    const tenantId = deps.resolveTenantId(req.auth, payload.tenantId);
    if (req.auth && !deps.canAccessTenant(req.auth, tenantId)) {
      return deps.sendError(res, 403, 'FORBIDDEN', 'Tenant access denied.');
    }
    if (!(await deps.assertTenantOperational(res, tenantId))) {
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

    await repo.upsertOrder(order.orderId, order);
    await repo.persistOrders();

    if (!(await repo.getTracking(order.orderId))) {
      await repo.upsertTracking(order.orderId, deps.createInitialTracking(order));
      await repo.persistTracking();
    }

    deps.audit?.({
      action: 'order.create',
      entityType: 'order',
      entityId: order.orderId,
      tenantId: order.tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: {
        paymentMethod: order.paymentMethod,
        deliveryFeeMode: order.deliveryFeeMode,
      },
    });

    return res.status(201).json(order);
  }

  async function requestCustomerLookupOtp(req, res) {
    const { phone, tenantId } = req.body || {};
    const normalizedPhone = deps.normalizePhone(phone);
    if (normalizedPhone.length < 10) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'phone must contain at least 10 digits.');
    }

    const resolvedTenantId = deps.resolvePublicTenantId(req.auth, tenantId);
    if (!(await deps.tenantExists(resolvedTenantId))) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Tenant not found.');
    }

    await repo.pruneExpiredOtps();

    const now = Date.now();
    const requestId = `otp_${now}_${Math.floor(Math.random() * 900 + 100)}`;
    const otpCode = deps.generateNumericOtp();
    const expiresAt = now + deps.customerLookupOtpTtlMs;
    await repo.upsertOtp(requestId, {
      requestId,
      phone: normalizedPhone,
      tenantId: resolvedTenantId,
      otpCode,
      attempts: 0,
      createdAt: now,
      expiresAt,
    });
    await repo.persistCustomerLookupOtp();

    const responsePayload = {
      requestId,
      expiresAt,
    };
    if (deps.includeDebugOtp) {
      responsePayload.debugOtp = otpCode;
    }

    return res.status(200).json(responsePayload);
  }

  async function lookupCustomerOrders(req, res) {
    const { phone, requestId, otpCode } = req.body || {};
    const normalizedPhone = deps.normalizePhone(phone);
    if (normalizedPhone.length < 10) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'phone must contain at least 10 digits.');
    }
    if (!deps.isNonEmptyString(requestId) || !deps.isNonEmptyString(otpCode)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'requestId and otpCode are required.');
    }

    await repo.pruneExpiredOtps();
    const otpRecord = await repo.getOtp(requestId);
    if (!otpRecord) {
      return deps.sendError(res, 400, 'OTP_REQUEST_INVALID', 'OTP request is invalid or expired.');
    }

    const resolvedTenantId = deps.resolvePublicTenantId(req.auth, otpRecord.tenantId);
    if (otpRecord.tenantId !== resolvedTenantId) {
      return deps.sendError(res, 403, 'FORBIDDEN', 'Tenant access denied.');
    }

    const expectedPhoneLast10 = deps.normalizeLast10(otpRecord.phone);
    const providedPhoneLast10 = deps.normalizeLast10(normalizedPhone);
    if (expectedPhoneLast10 !== providedPhoneLast10) {
      return deps.sendError(res, 400, 'PHONE_MISMATCH', 'phone does not match OTP request.');
    }

    if (otpRecord.otpCode !== String(otpCode).trim()) {
      const attempts = Number.isFinite(otpRecord.attempts) ? otpRecord.attempts + 1 : 1;
      if (attempts >= deps.customerLookupOtpMaxAttempts) {
        await repo.deleteOtp(requestId);
        await repo.persistCustomerLookupOtp();
        return deps.sendError(
          res,
          400,
          'OTP_ATTEMPTS_EXCEEDED',
          'Maximum OTP attempts exceeded. Please request a new OTP.'
        );
      }

      await repo.upsertOtp(requestId, {
        ...otpRecord,
        attempts,
      });
      await repo.persistCustomerLookupOtp();
      return deps.sendError(res, 400, 'INVALID_OTP', 'Invalid OTP. Please try again.', {
        attemptsRemaining: deps.customerLookupOtpMaxAttempts - attempts,
      });
    }

    await repo.deleteOtp(requestId);
    await repo.persistCustomerLookupOtp();

    const orders = await repo.listOrdersByTenantAndPhone(otpRecord.tenantId, providedPhoneLast10);
    orders.sort((a, b) => b.createdAt - a.createdAt);

    return res.status(200).json(orders);
  }

  async function getOrder(req, res) {
    const order = await repo.getOrder(req.params.orderId);
    if (!order) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
    }
    if (req.auth && !deps.canAccessTenant(req.auth, order.tenantId || deps.defaultTenantId)) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
    }
    return res.status(200).json(order);
  }

  async function listOrders(req, res) {
    let orders = await repo.listOrders();
    if (!deps.isPlatformAdmin(req.auth)) {
      orders = orders.filter((order) =>
        deps.canAccessTenant(req.auth, order.tenantId || deps.defaultTenantId)
      );
    } else if (deps.isNonEmptyString(req.query.tenantId)) {
      orders = orders.filter((order) => (order.tenantId || deps.defaultTenantId) === req.query.tenantId);
    }

    if (deps.isNonEmptyString(req.query.status)) {
      orders = orders.filter((order) => order.status === req.query.status);
    }

    const fromTime = deps.parseOptionalTime(req.query.from);
    if (fromTime !== null) {
      orders = orders.filter((order) => order.createdAt >= fromTime);
    }

    const toTime = deps.parseOptionalTime(req.query.to);
    if (toTime !== null) {
      orders = orders.filter((order) => order.createdAt <= toTime);
    }

    orders.sort((a, b) => b.createdAt - a.createdAt);

    const offset = deps.toOptionalInt(req.query.offset, 0);
    const limit = deps.toOptionalInt(req.query.limit, orders.length);
    orders = orders.slice(offset, offset + limit);

    return res.status(200).json(orders);
  }

  async function updateOrderStatus(req, res) {
    const orderId = req.params.orderId;
    const order = await repo.getOrder(orderId);
    if (!order) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
    }
    if (!deps.canAccessTenant(req.auth, order.tenantId || deps.defaultTenantId)) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
    }
    if (!(await deps.assertTenantOperational(res, order.tenantId || deps.defaultTenantId))) {
      return;
    }

    const { status } = req.body || {};
    if (!deps.ORDER_STATUSES.has(status)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid order status.');
    }

    const allowed = deps.ORDER_STATUS_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return deps.sendError(res, 400, 'INVALID_TRANSITION', 'Invalid status transition.');
    }

    const updated = {
      ...order,
      status,
      updatedAt: Date.now(),
    };
    await repo.upsertOrder(orderId, updated);
    await repo.persistOrders();
    await deps.upsertTrackingFromOrderStatus(updated);
    deps.audit?.({
      action: 'order.status_update',
      entityType: 'order',
      entityId: orderId,
      tenantId: updated.tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: { status },
    });

    return res.status(200).json(updated);
  }

  async function confirmDelivery(req, res) {
    const orderId = req.params.orderId;
    const order = await repo.getOrder(orderId);
    if (!order) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
    }
    if (!deps.canAccessTenant(req.auth, order.tenantId || deps.defaultTenantId)) {
      return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
    }
    if (!(await deps.assertTenantOperational(res, order.tenantId || deps.defaultTenantId))) {
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

    if (!deps.isNonEmptyString(otpCode)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'otpCode is required.');
    }
    if (!deps.isNonEmptyString(confirmedBy)) {
      return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'confirmedBy is required.');
    }

    const expectedOtp = order.deliveryConfirmation?.expectedOtp;
    const otpVerified = !deps.isNonEmptyString(expectedOtp) || expectedOtp === otpCode;
    if (!otpVerified) {
      return deps.sendError(res, 400, 'INVALID_OTP', 'Invalid delivery OTP.');
    }

    const now = Date.now();
    let nextSettlement = order.deliveryFeeSettlementStatus || deps.defaultSettlementStatus(order.deliveryFeeMode);
    let deliveryFeeCollection = order.deliveryFeeCollection;

    if (order.deliveryFeeMode === 'collect_at_drop') {
      if (collectDeliveryFee) {
        const amount = Number(collectionAmount);
        if (!Number.isFinite(amount) || amount < 0) {
          return deps.sendError(
            res,
            400,
            'INVALID_PAYLOAD',
            'collectionAmount must be a non-negative number.'
          );
        }
        if (!['cash', 'upi'].includes(collectionMethod)) {
          return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'collectionMethod must be cash or upi.');
        }

        nextSettlement = 'collected';
        deliveryFeeCollection = {
          amountCollected: amount,
          method: collectionMethod,
          collectedAt: now,
          collectedBy: confirmedBy,
          notes: deps.isNonEmptyString(collectionNotes) ? collectionNotes : undefined,
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
        proofNote: deps.isNonEmptyString(proofNote) ? proofNote : undefined,
        deliveredAt: now,
        confirmedBy,
      },
      updatedAt: now,
    };

    await repo.upsertOrder(orderId, updated);
    await repo.persistOrders();

    const tracking = await repo.getTracking(orderId);
    if (tracking) {
      const lastStatus = tracking.events[tracking.events.length - 1]?.status;
      const events =
        lastStatus === 'delivered'
          ? tracking.events
          : [
              ...tracking.events,
              {
                status: 'delivered',
                label: deps.deliveryStatusLabel('delivered'),
                time: now,
              },
            ];
      await repo.upsertTracking(orderId, {
        ...tracking,
        status: 'delivered',
        etaMinutes: 0,
        events,
        updatedAt: now,
      });
      await repo.persistTracking();
    }

    deps.audit?.({
      action: 'order.delivery_confirm',
      entityType: 'order',
      entityId: orderId,
      tenantId: updated.tenantId,
      actorUserId: req.auth?.userId,
      actorEmail: req.auth?.email,
      status: 'success',
      details: {
        settlementStatus: nextSettlement,
        collected: Boolean(collectDeliveryFee),
      },
    });

    return res.status(200).json(updated);
  }

  return {
    createOrder,
    requestCustomerLookupOtp,
    lookupCustomerOrders,
    getOrder,
    listOrders,
    updateOrderStatus,
    confirmDelivery,
  };
}

module.exports = {
  createOrdersService,
};

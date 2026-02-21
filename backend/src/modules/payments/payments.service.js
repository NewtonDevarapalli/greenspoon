const crypto = require('crypto');

function createPaymentsService(deps) {
  const repo = deps.repository;

  async function createRazorpayOrder(req, res) {
    try {
      const { orderReference, amount, currency } = req.body || {};
      if (!deps.isNonEmptyString(orderReference)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'orderReference is required.');
      }
      if (!deps.isPositiveNumber(amount)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'amount must be greater than 0.');
      }
      if (currency !== 'INR') {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'currency must be INR.');
      }

      const providerOrderId = `order_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
      await repo.upsertPaymentOrder(providerOrderId, {
        orderReference,
        amount,
        currency,
        createdAt: Date.now(),
      });
      await repo.persistPaymentOrders();

      deps.audit?.({
        action: 'payment.order_create',
        entityType: 'payment_order',
        entityId: providerOrderId,
        tenantId: req.auth?.tenantId || null,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { orderReference, amount, currency },
      });

      return res.status(200).json({
        provider: 'razorpay',
        providerOrderId,
        amount,
        currency,
        keyId: deps.razorpayKeyId,
      });
    } catch {
      return deps.sendError(res, 500, 'PAYMENT_ORDER_CREATE_FAILED', 'Payment order creation failed.');
    }
  }

  async function verifyRazorpayPayment(req, res) {
    try {
      const { orderReference, providerOrderId, paymentId, signature } = req.body || {};
      if (
        !deps.isNonEmptyString(orderReference) ||
        !deps.isNonEmptyString(providerOrderId) ||
        !deps.isNonEmptyString(paymentId) ||
        !deps.isNonEmptyString(signature)
      ) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'orderReference, providerOrderId, paymentId, and signature are required.'
        );
      }

      const paymentOrder = await repo.getPaymentOrder(providerOrderId);
      if (!paymentOrder) {
        deps.audit?.({
          action: 'payment.verify',
          entityType: 'payment_order',
          entityId: providerOrderId,
          tenantId: req.auth?.tenantId || null,
          actorUserId: req.auth?.userId,
          actorEmail: req.auth?.email,
          status: 'failed',
          details: { reason: 'provider_order_missing', orderReference },
        });
        return deps.sendError(res, 404, 'NOT_FOUND', 'Payment order not found.');
      }

      const orderMatches = paymentOrder.orderReference === orderReference;
      let verified = orderMatches;
      if (verified && deps.razorpayKeySecret) {
        const expected = crypto
          .createHmac('sha256', deps.razorpayKeySecret)
          .update(`${providerOrderId}|${paymentId}`)
          .digest('hex');
        verified = expected === signature;
      }

      deps.audit?.({
        action: 'payment.verify',
        entityType: 'payment_order',
        entityId: providerOrderId,
        tenantId: req.auth?.tenantId || null,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: verified ? 'success' : 'failed',
        details: { orderReference, paymentId, orderMatches },
      });

      return res.status(200).json({
        verified,
        paymentReference: paymentId,
        message: verified ? 'Payment verified.' : 'Payment verification failed.',
      });
    } catch {
      return deps.sendError(res, 500, 'PAYMENT_VERIFY_FAILED', 'Payment verification failed.');
    }
  }

  return {
    createRazorpayOrder,
    verifyRazorpayPayment,
  };
}

module.exports = {
  createPaymentsService,
};

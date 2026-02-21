const crypto = require('crypto');

function createNotificationsService(deps) {
  const repo = deps.repository;

  async function queueWhatsAppConfirmation(req, res) {
    try {
      const { orderId, customerName, customerPhone, message } = req.body || {};
      if (
        !deps.isNonEmptyString(orderId) ||
        !deps.isNonEmptyString(customerName) ||
        !deps.isNonEmptyString(customerPhone) ||
        !deps.isNonEmptyString(message)
      ) {
        return deps.sendError(
          res,
          400,
          'INVALID_PAYLOAD',
          'orderId, customerName, customerPhone, and message are required.'
        );
      }

      const order = await repo.getOrder(orderId);
      if (!order || !deps.canAccessTenant(req.auth, order.tenantId || deps.defaultTenantId)) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Order not found.');
      }
      if (!(await deps.assertTenantOperational(res, order.tenantId || deps.defaultTenantId))) {
        return;
      }

      const providerMessageId = `wamid.${crypto.randomBytes(8).toString('hex')}`;
      await repo.appendNotification({
        tenantId: order.tenantId || deps.defaultTenantId,
        orderId,
        customerName,
        customerPhone,
        message,
        channel: 'whatsapp',
        queued: true,
        providerMessageId,
        createdAt: Date.now(),
      });
      await repo.persistNotifications();

      deps.audit?.({
        action: 'notification.whatsapp_confirmation',
        entityType: 'notification',
        entityId: providerMessageId,
        tenantId: order.tenantId || deps.defaultTenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { orderId, channel: 'whatsapp' },
      });

      return res.status(200).json({
        queued: true,
        channel: 'whatsapp',
        providerMessageId,
      });
    } catch {
      return deps.sendError(
        res,
        500,
        'NOTIFICATION_QUEUE_FAILED',
        'Notification queueing failed due to server error.'
      );
    }
  }

  return {
    queueWhatsAppConfirmation,
  };
}

module.exports = {
  createNotificationsService,
};

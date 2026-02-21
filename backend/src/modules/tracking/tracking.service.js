function createTrackingService(deps) {
  const repo = deps.repository;

  async function getTracking(req, res) {
    try {
      const tracking = await repo.getTracking(req.params.orderId);
      if (!tracking) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
      }
      if (req.auth && !deps.canAccessTenant(req.auth, tracking.tenantId || deps.defaultTenantId)) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
      }
      return res.status(200).json(tracking);
    } catch {
      return deps.sendError(res, 500, 'TRACKING_READ_FAILED', 'Tracking read failed due to server error.');
    }
  }

  async function updateTrackingLocation(req, res) {
    try {
      const orderId = req.params.orderId;
      const tracking = await repo.getTracking(orderId);
      if (!tracking) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
      }
      if (!deps.canAccessTenant(req.auth, tracking.tenantId || deps.defaultTenantId)) {
        return deps.sendError(res, 404, 'NOT_FOUND', 'Tracking not found.');
      }
      if (!(await deps.assertTenantOperational(res, tracking.tenantId || deps.defaultTenantId))) {
        return;
      }

      const { lat, lng, status, etaMinutes } = req.body || {};
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'lat and lng are required.');
      }
      if (!deps.DELIVERY_STATUSES.has(status)) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid delivery status.');
      }
      if (!Number.isFinite(etaMinutes) || etaMinutes < 0) {
        return deps.sendError(res, 400, 'INVALID_PAYLOAD', 'etaMinutes must be >= 0.');
      }

      const now = Date.now();
      const existingEvents = Array.isArray(tracking.events) ? tracking.events : [];
      const lastStatus = existingEvents[existingEvents.length - 1]?.status;
      const events =
        lastStatus === status
          ? existingEvents
          : [
              ...existingEvents,
              {
                status,
                label: deps.deliveryStatusLabel(status),
                time: now,
              },
            ];

      await repo.upsertTracking(orderId, {
        ...tracking,
        status,
        etaMinutes,
        current: { lat, lng },
        events,
        updatedAt: now,
      });
      await repo.persistTracking();

      deps.audit?.({
        action: 'tracking.location_update',
        entityType: 'tracking',
        entityId: orderId,
        tenantId: tracking.tenantId || deps.defaultTenantId,
        actorUserId: req.auth?.userId,
        actorEmail: req.auth?.email,
        status: 'success',
        details: { status, etaMinutes },
      });

      return res.status(200).json({ ok: true });
    } catch {
      return deps.sendError(res, 500, 'TRACKING_UPDATE_FAILED', 'Tracking update failed due to server error.');
    }
  }

  return {
    getTracking,
    updateTrackingLocation,
  };
}

module.exports = {
  createTrackingService,
};

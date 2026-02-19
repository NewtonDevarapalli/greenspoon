import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DeliveryCollectionMethod } from '../models/order';
import { OrderRecord } from '../models/order';
import { OrderApiService } from '../services/order-api';
import { DeliveryStatus, TrackingOrder, TrackingService } from '../services/tracking';

@Component({
  selector: 'app-admin-dispatch',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-dispatch.html',
  styleUrl: './admin-dispatch.scss',
})
export class AdminDispatch implements OnInit {
  readonly loading = signal(true);
  readonly busyUpdate = signal(false);
  readonly busyNotify = signal(false);
  readonly busyConfirm = signal(false);
  readonly statusMessage = signal('');
  readonly errorMessage = signal('');
  readonly orders = signal<OrderRecord[]>([]);
  readonly selectedOrderId = signal('');
  readonly tracking = signal<TrackingOrder | null>(null);

  latInput = '';
  lngInput = '';
  etaInput = '20';
  deliveryStatus: DeliveryStatus = 'on_the_way';

  deliveryOtpInput = '';
  proofNoteInput = '';
  confirmedByInput = 'Dispatch Team';
  collectDeliveryFee = false;
  collectionAmountInput = '';
  collectionMethod: DeliveryCollectionMethod = 'cash';
  collectionNotesInput = '';

  readonly deliveryStatuses: DeliveryStatus[] = [
    'assigned',
    'picked_up',
    'on_the_way',
    'nearby',
    'delivered',
  ];

  readonly selectedOrder = computed(() =>
    this.orders().find((order) => order.orderId === this.selectedOrderId()) ?? null
  );

  readonly activeOrders = computed(() =>
    this.orders().filter(
      (order) => order.status !== 'cancelled' && order.status !== 'delivered'
    )
  );

  constructor(
    private readonly orderApi: OrderApiService,
    private readonly trackingService: TrackingService
  ) {}

  ngOnInit(): void {
    void this.loadOrders();
  }

  async refresh(): Promise<void> {
    await this.loadOrders();
  }

  async onOrderSelectionChange(): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    await this.loadTrackingForSelectedOrder();
  }

  async pushTrackingUpdate(): Promise<void> {
    const order = this.selectedOrder();
    if (!order) {
      this.errorMessage.set('Select an order first.');
      return;
    }

    const lat = Number.parseFloat(this.latInput);
    const lng = Number.parseFloat(this.lngInput);
    const eta = Number.parseInt(this.etaInput, 10);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      this.errorMessage.set('Latitude and longitude must be valid numbers.');
      return;
    }
    if (!Number.isFinite(eta) || eta < 0) {
      this.errorMessage.set('ETA must be a non-negative number.');
      return;
    }

    this.busyUpdate.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');

    try {
      const ok = await this.trackingService.updateTrackingLocation(order.orderId, {
        lat,
        lng,
        status: this.deliveryStatus,
        etaMinutes: eta,
      });
      if (!ok) {
        this.errorMessage.set('Tracking not found for this order.');
        return;
      }

      await this.loadTrackingForSelectedOrder();
      this.statusMessage.set('Tracking updated successfully.');
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyUpdate.set(false);
    }
  }

  async queueWhatsAppConfirmation(): Promise<void> {
    const order = this.selectedOrder();
    if (!order) {
      this.errorMessage.set('Select an order first.');
      return;
    }

    const message = this.buildCustomerMessage(order);

    this.busyNotify.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const response = await this.orderApi.queueWhatsAppConfirmation({
        orderId: order.orderId,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        message,
      });

      this.statusMessage.set(
        response.providerMessageId
          ? `WhatsApp confirmation queued (${response.providerMessageId}).`
          : 'WhatsApp confirmation queued.'
      );
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyNotify.set(false);
    }
  }

  async confirmDelivery(): Promise<void> {
    const order = this.selectedOrder();
    if (!order) {
      this.errorMessage.set('Select an order first.');
      return;
    }

    if (!this.deliveryOtpInput.trim()) {
      this.errorMessage.set('Delivery OTP is required.');
      return;
    }

    let collectionAmount: number | undefined;
    if (this.collectDeliveryFee) {
      const parsed = Number.parseFloat(this.collectionAmountInput);
      if (!Number.isFinite(parsed) || parsed < 0) {
        this.errorMessage.set('Collection amount must be a non-negative number.');
        return;
      }
      collectionAmount = parsed;
    }

    this.busyConfirm.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const updatedOrder = await this.orderApi.confirmDelivery(order.orderId, {
        otpCode: this.deliveryOtpInput.trim(),
        proofNote: this.proofNoteInput.trim() || undefined,
        confirmedBy: this.confirmedByInput.trim() || 'Dispatch Team',
        collectDeliveryFee: this.collectDeliveryFee,
        collectionAmount,
        collectionMethod: this.collectDeliveryFee ? this.collectionMethod : undefined,
        collectionNotes: this.collectDeliveryFee
          ? this.collectionNotesInput.trim() || undefined
          : undefined,
      });

      if (!updatedOrder) {
        this.errorMessage.set('Order not found.');
        return;
      }

      const fallbackTracking = this.tracking();
      await this.trackingService.updateTrackingLocation(order.orderId, {
        lat: Number.parseFloat(this.latInput || '0') || fallbackTracking?.current.lat || 17.385,
        lng:
          Number.parseFloat(this.lngInput || '0') || fallbackTracking?.current.lng || 78.4867,
        status: 'delivered',
        etaMinutes: 0,
      });

      this.orders.update((list) =>
        list.map((item) => (item.orderId === updatedOrder.orderId ? updatedOrder : item))
      );
      await this.loadTrackingForSelectedOrder();
      this.statusMessage.set('Delivery confirmed successfully.');
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyConfirm.set(false);
    }
  }

  deliveryLabel(status: DeliveryStatus): string {
    switch (status) {
      case 'assigned':
        return 'Assigned';
      case 'picked_up':
        return 'Picked Up';
      case 'on_the_way':
        return 'On The Way';
      case 'nearby':
        return 'Nearby';
      case 'delivered':
        return 'Delivered';
      default:
        return status;
    }
  }

  private async loadOrders(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const list = await this.orderApi.listOrders();
      this.orders.set(list);
      const active = list.filter(
        (order) => order.status !== 'cancelled' && order.status !== 'delivered'
      );

      if (
        (!this.selectedOrderId() ||
          !active.some((o) => o.orderId === this.selectedOrderId())) &&
        active.length > 0
      ) {
        this.selectedOrderId.set(active[0].orderId);
      }

      if (this.selectedOrderId()) {
        await this.loadTrackingForSelectedOrder();
      } else {
        this.tracking.set(null);
      }
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadTrackingForSelectedOrder(): Promise<void> {
    const orderId = this.selectedOrderId();
    if (!orderId) {
      this.tracking.set(null);
      return;
    }

    try {
      const tracking = await this.trackingService.getOrder(orderId);
      this.tracking.set(tracking);

      if (tracking) {
        this.latInput = tracking.current.lat.toFixed(6);
        this.lngInput = tracking.current.lng.toFixed(6);
        this.etaInput = String(tracking.etaMinutes);
        this.deliveryStatus = tracking.status;
      } else {
        this.latInput = '';
        this.lngInput = '';
        this.etaInput = '20';
        this.deliveryStatus = 'on_the_way';
      }

      const order = this.selectedOrder();
      if (order) {
        this.collectDeliveryFee = order.deliveryFeeMode === 'collect_at_drop';
        this.collectionAmountInput = String(
          order.totals.deliveryFeeDueAtDrop ?? order.totals.deliveryFee
        );
      }
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    }
  }

  private buildCustomerMessage(order: OrderRecord): string {
    const eta = this.etaInput || '0';
    const status = this.deliveryLabel(this.deliveryStatus);
    const deliveryDue = order.totals.deliveryFeeDueAtDrop ?? 0;
    const dueText =
      deliveryDue > 0
        ? ` Please pay delivery charge INR ${deliveryDue} at drop location.`
        : '';
    return (
      `Hi ${order.customer.name}, your Green Spoon order ${order.orderId} is currently ${status}. ` +
      `Estimated delivery in ${eta} minutes.${dueText}`
    );
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error?.message === 'string') {
        return error.error.message;
      }
      return `Request failed with status ${error.status}.`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unexpected error. Please try again.';
  }
}

import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { OrderApiService } from '../services/order-api';
import { OrderRecord, OrderStatus } from '../models/order';

type FilterStatus = 'all' | OrderStatus;

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
})
export class AdminOrders implements OnInit {
  readonly statusFilters: FilterStatus[] = [
    'all',
    'created',
    'confirmed',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
  ];

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly filter = signal<FilterStatus>('all');
  readonly orders = signal<OrderRecord[]>([]);
  readonly activeUpdateKey = signal('');

  readonly filteredOrders = computed(() => {
    const status = this.filter();
    const list = this.orders();
    if (status === 'all') {
      return list;
    }
    return list.filter((order) => order.status === status);
  });

  readonly statusCounters = computed(() => {
    const counters: Record<FilterStatus, number> = {
      all: this.orders().length,
      created: 0,
      confirmed: 0,
      preparing: 0,
      out_for_delivery: 0,
      delivered: 0,
      cancelled: 0,
    };

    for (const order of this.orders()) {
      counters[order.status] += 1;
    }
    return counters;
  });

  private readonly transitions: Record<OrderStatus, OrderStatus[]> = {
    created: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  constructor(private readonly orderApi: OrderApiService) {}

  ngOnInit(): void {
    void this.loadOrders();
  }

  async refresh(): Promise<void> {
    await this.loadOrders();
  }

  setFilter(status: FilterStatus): void {
    this.filter.set(status);
  }

  nextStatuses(order: OrderRecord): OrderStatus[] {
    return this.transitions[order.status] ?? [];
  }

  canUpdate(order: OrderRecord, nextStatus: OrderStatus): boolean {
    const actionKey = this.getActionKey(order.orderId, nextStatus);
    return this.activeUpdateKey() !== actionKey;
  }

  async updateStatus(order: OrderRecord, nextStatus: OrderStatus): Promise<void> {
    this.errorMessage.set('');
    const actionKey = this.getActionKey(order.orderId, nextStatus);
    this.activeUpdateKey.set(actionKey);

    try {
      const updated = await this.orderApi.updateOrderStatus(order.orderId, nextStatus);
      if (!updated) {
        this.errorMessage.set('Order not found. Please refresh.');
        return;
      }

      this.orders.update((list) =>
        list.map((item) => (item.orderId === updated.orderId ? updated : item))
      );
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.activeUpdateKey.set('');
    }
  }

  trackOrder(_index: number, order: OrderRecord): string {
    return order.orderId;
  }

  statusLabel(status: FilterStatus): string {
    switch (status) {
      case 'all':
        return 'All';
      case 'created':
        return 'Created';
      case 'confirmed':
        return 'Confirmed';
      case 'preparing':
        return 'Preparing';
      case 'out_for_delivery':
        return 'Out For Delivery';
      case 'delivered':
        return 'Delivered';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  paymentLabel(mode: string): string {
    return mode === 'razorpay' ? 'Razorpay' : 'WhatsApp';
  }

  private async loadOrders(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const list = await this.orderApi.listOrders();
      this.orders.set(list);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
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

  private getActionKey(orderId: string, nextStatus: OrderStatus): string {
    return `${orderId}:${nextStatus}`;
  }
}

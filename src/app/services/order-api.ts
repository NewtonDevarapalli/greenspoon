import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { OrderCreatePayload } from '../models/order';
import { OrderRecord } from '../models/order';
import { OrderStatus } from '../models/order';
import { RazorpayOrderCreatePayload } from '../models/order';
import { RazorpayOrderResponse } from '../models/order';
import { RazorpayVerifyPayload } from '../models/order';
import { RazorpayVerifyResponse } from '../models/order';

interface OrderApiAdapter {
  createOrder(payload: OrderCreatePayload): Promise<OrderRecord>;
  getOrder(orderId: string): Promise<OrderRecord | null>;
  listOrders(): Promise<OrderRecord[]>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<OrderRecord | null>;
  createRazorpayOrder(
    payload: RazorpayOrderCreatePayload
  ): Promise<RazorpayOrderResponse>;
  verifyRazorpayPayment(
    payload: RazorpayVerifyPayload
  ): Promise<RazorpayVerifyResponse>;
}

@Injectable({ providedIn: 'root' })
export class LocalOrderApiService implements OrderApiAdapter {
  private readonly storageKey = 'greenspoon-orders-v1';
  private readonly paymentOrdersKey = 'greenspoon-payment-orders-v1';

  async createOrder(payload: OrderCreatePayload): Promise<OrderRecord> {
    const now = Date.now();
    const order: OrderRecord = {
      ...payload,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };

    const orders = this.readAll();
    orders[order.orderId] = order;
    this.persistAll(orders);

    return order;
  }

  async getOrder(orderId: string): Promise<OrderRecord | null> {
    const orders = this.readAll();
    return orders[orderId] ?? null;
  }

  async listOrders(): Promise<OrderRecord[]> {
    const orders = Object.values(this.readAll());
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<OrderRecord | null> {
    const orders = this.readAll();
    const existing = orders[orderId];
    if (!existing) {
      return null;
    }

    const updated: OrderRecord = {
      ...existing,
      status,
      updatedAt: Date.now(),
    };
    orders[orderId] = updated;
    this.persistAll(orders);
    return updated;
  }

  async createRazorpayOrder(
    payload: RazorpayOrderCreatePayload
  ): Promise<RazorpayOrderResponse> {
    const providerOrderId = `order_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
    const orders = this.readPaymentOrders();
    orders[providerOrderId] = payload;
    this.persistPaymentOrders(orders);

    return {
      provider: 'razorpay',
      providerOrderId,
      amount: payload.amount,
      currency: payload.currency,
      keyId: environment.payment.razorpayKeyId,
    };
  }

  async verifyRazorpayPayment(
    payload: RazorpayVerifyPayload
  ): Promise<RazorpayVerifyResponse> {
    const orders = this.readPaymentOrders();
    const paymentOrder = orders[payload.providerOrderId];
    if (!paymentOrder) {
      return {
        verified: false,
        paymentReference: payload.paymentId,
        message: 'Payment order not found.',
      };
    }

    const isOrderMatch = paymentOrder.orderReference === payload.orderReference;
    const hasFields = Boolean(payload.paymentId && payload.signature);
    const verified = isOrderMatch && hasFields;

    return {
      verified,
      paymentReference: payload.paymentId,
      message: verified ? 'Payment verified in local mode.' : 'Payment verification failed.',
    };
  }

  private readAll(): Record<string, OrderRecord> {
    try {
      if (!this.canUseStorage()) {
        return {};
      }

      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as Record<string, OrderRecord>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistAll(data: Record<string, OrderRecord>): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  private readPaymentOrders(): Record<string, RazorpayOrderCreatePayload> {
    try {
      if (!this.canUseStorage()) {
        return {};
      }

      const raw = localStorage.getItem(this.paymentOrdersKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as Record<string, RazorpayOrderCreatePayload>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistPaymentOrders(
    data: Record<string, RazorpayOrderCreatePayload>
  ): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.paymentOrdersKey, JSON.stringify(data));
  }
}

@Injectable({ providedIn: 'root' })
export class HttpOrderApiService implements OrderApiAdapter {
  private readonly baseUrl = environment.api.baseUrl;

  constructor(private readonly http: HttpClient) {}

  async createOrder(payload: OrderCreatePayload): Promise<OrderRecord> {
    return firstValueFrom(
      this.http.post<OrderRecord>(`${this.baseUrl}/orders`, payload)
    );
  }

  async getOrder(orderId: string): Promise<OrderRecord | null> {
    try {
      return await firstValueFrom(
        this.http.get<OrderRecord>(`${this.baseUrl}/orders/${orderId}`)
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async listOrders(): Promise<OrderRecord[]> {
    return firstValueFrom(this.http.get<OrderRecord[]>(`${this.baseUrl}/orders`));
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<OrderRecord | null> {
    try {
      return await firstValueFrom(
        this.http.patch<OrderRecord>(`${this.baseUrl}/orders/${orderId}/status`, {
          status,
        })
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async createRazorpayOrder(
    payload: RazorpayOrderCreatePayload
  ): Promise<RazorpayOrderResponse> {
    return firstValueFrom(
      this.http.post<RazorpayOrderResponse>(
        `${this.baseUrl}/payments/razorpay/order`,
        payload
      )
    );
  }

  async verifyRazorpayPayment(
    payload: RazorpayVerifyPayload
  ): Promise<RazorpayVerifyResponse> {
    return firstValueFrom(
      this.http.post<RazorpayVerifyResponse>(
        `${this.baseUrl}/payments/razorpay/verify`,
        payload
      )
    );
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 404;
  }
}

@Injectable({ providedIn: 'root' })
export class OrderApiService implements OrderApiAdapter {
  private readonly adapter: OrderApiAdapter;

  constructor(
    private readonly local: LocalOrderApiService,
    private readonly remote: HttpOrderApiService
  ) {
    this.adapter = environment.api.orderApiMode === 'http' ? this.remote : this.local;
  }

  createOrder(payload: OrderCreatePayload): Promise<OrderRecord> {
    return this.adapter.createOrder(payload);
  }

  getOrder(orderId: string): Promise<OrderRecord | null> {
    return this.adapter.getOrder(orderId);
  }

  listOrders(): Promise<OrderRecord[]> {
    return this.adapter.listOrders();
  }

  updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<OrderRecord | null> {
    return this.adapter.updateOrderStatus(orderId, status);
  }

  createRazorpayOrder(
    payload: RazorpayOrderCreatePayload
  ): Promise<RazorpayOrderResponse> {
    return this.adapter.createRazorpayOrder(payload);
  }

  verifyRazorpayPayment(
    payload: RazorpayVerifyPayload
  ): Promise<RazorpayVerifyResponse> {
    return this.adapter.verifyRazorpayPayment(payload);
  }
}

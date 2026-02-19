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
import { WhatsAppConfirmationRequest } from '../models/order';
import { WhatsAppConfirmationResponse } from '../models/order';
import { DeliveryConfirmationPayload } from '../models/order';
import { DeliveryFeeMode } from '../models/order';
import { DeliveryFeeSettlementStatus } from '../models/order';
import { CustomerLookupOtpRequest } from '../models/order';
import { CustomerLookupOtpResponse } from '../models/order';
import { CustomerOrderLookupRequest } from '../models/order';

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
  queueWhatsAppConfirmation(
    payload: WhatsAppConfirmationRequest
  ): Promise<WhatsAppConfirmationResponse>;
  confirmDelivery(
    orderId: string,
    payload: DeliveryConfirmationPayload
  ): Promise<OrderRecord | null>;
  requestCustomerLookupOtp(
    payload: CustomerLookupOtpRequest
  ): Promise<CustomerLookupOtpResponse>;
  lookupCustomerOrdersByPhone(
    payload: CustomerOrderLookupRequest
  ): Promise<OrderRecord[]>;
}

@Injectable({ providedIn: 'root' })
export class LocalOrderApiService implements OrderApiAdapter {
  private readonly storageKey = 'greenspoon-orders-v1';
  private readonly paymentOrdersKey = 'greenspoon-payment-orders-v1';
  private readonly defaultTenantId = 'greenspoon-demo-tenant';
  private readonly customerOtpKey = 'greenspoon-customer-lookup-otp-v1';
  private readonly allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
    created: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
    out_for_delivery: [],
    delivered: [],
    cancelled: [],
  };

  async createOrder(payload: OrderCreatePayload): Promise<OrderRecord> {
    const now = Date.now();
    const deliveryFeeMode: DeliveryFeeMode = payload.deliveryFeeMode ?? 'prepaid';
    const deliveryFeeSettlementStatus =
      payload.deliveryFeeSettlementStatus ??
      this.defaultSettlementStatus(deliveryFeeMode);
    const tenantId = payload.tenantId ?? this.defaultTenantId;
    const order: OrderRecord = {
      ...payload,
      tenantId,
      status: 'confirmed',
      deliveryFeeMode,
      deliveryFeeSettlementStatus,
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

    if (!this.isValidTransition(existing.status, status)) {
      throw new Error(
        `Invalid status transition: ${existing.status} -> ${status}`
      );
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

  async queueWhatsAppConfirmation(
    payload: WhatsAppConfirmationRequest
  ): Promise<WhatsAppConfirmationResponse> {
    const fallbackId = `local-${payload.orderId}-${Date.now()}`;
    return {
      queued: true,
      channel: 'whatsapp',
      providerMessageId: fallbackId,
    };
  }

  async confirmDelivery(
    orderId: string,
    payload: DeliveryConfirmationPayload
  ): Promise<OrderRecord | null> {
    const orders = this.readAll();
    const existing = orders[orderId];
    if (!existing) {
      return null;
    }

    const expectedOtp = existing.deliveryConfirmation?.expectedOtp;
    const otpVerified = !expectedOtp || expectedOtp === payload.otpCode;
    if (!otpVerified) {
      throw new Error('Invalid OTP. Delivery cannot be confirmed.');
    }

    const now = Date.now();
    const shouldCollect =
      existing.deliveryFeeMode === 'collect_at_drop' && payload.collectDeliveryFee;
    const collectedAmount = shouldCollect ? payload.collectionAmount ?? 0 : 0;

    const nextSettlement: DeliveryFeeSettlementStatus = shouldCollect
      ? 'collected'
      : existing.deliveryFeeMode === 'restaurant_settled'
      ? 'restaurant_settled'
      : existing.deliveryFeeMode === 'collect_at_drop'
      ? 'pending_collection'
      : 'not_applicable';

    const updated: OrderRecord = {
      ...existing,
      status: 'delivered',
      updatedAt: now,
      deliveryFeeSettlementStatus: nextSettlement,
      deliveryFeeCollection: shouldCollect
        ? {
            amountCollected: collectedAmount,
            method: payload.collectionMethod ?? 'cash',
            collectedAt: now,
            collectedBy: payload.confirmedBy,
            notes: payload.collectionNotes || undefined,
          }
        : existing.deliveryFeeCollection,
      deliveryConfirmation: {
        ...existing.deliveryConfirmation,
        receivedOtp: payload.otpCode,
        otpVerified,
        proofNote: payload.proofNote || undefined,
        deliveredAt: now,
        confirmedBy: payload.confirmedBy,
      },
    };

    orders[orderId] = updated;
    this.persistAll(orders);
    return updated;
  }

  async requestCustomerLookupOtp(
    payload: CustomerLookupOtpRequest
  ): Promise<CustomerLookupOtpResponse> {
    const phone = payload.phone.replace(/\D/g, '');
    if (phone.length < 10) {
      throw new Error('Enter a valid phone number.');
    }
    const requestId = `otp-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
    const debugOtp = `${Math.floor(1000 + Math.random() * 9000)}`;
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const store = this.readOtpStore();
    store[requestId] = {
      phone,
      debugOtp,
      expiresAt,
    };
    this.persistOtpStore(store);
    return { requestId, expiresAt, debugOtp };
  }

  async lookupCustomerOrdersByPhone(
    payload: CustomerOrderLookupRequest
  ): Promise<OrderRecord[]> {
    const phone = payload.phone.replace(/\D/g, '');
    const store = this.readOtpStore();
    const requested = store[payload.requestId];
    if (!requested || requested.expiresAt < Date.now()) {
      throw new Error('OTP request expired. Please request a new OTP.');
    }
    if (requested.phone.slice(-10) !== phone.slice(-10)) {
      throw new Error('Phone number does not match OTP request.');
    }
    if (payload.otpCode.trim() !== requested.debugOtp) {
      throw new Error('Invalid OTP.');
    }

    delete store[payload.requestId];
    this.persistOtpStore(store);

    return Object.values(this.readAll())
      .filter((order) => this.normalizePhone(order.customer.phone).endsWith(phone.slice(-10)))
      .sort((a, b) => b.createdAt - a.createdAt);
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

  private readOtpStore(): Record<string, { phone: string; debugOtp: string; expiresAt: number }> {
    try {
      if (!this.canUseStorage()) {
        return {};
      }
      const raw = localStorage.getItem(this.customerOtpKey);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<
        string,
        { phone: string; debugOtp: string; expiresAt: number }
      >;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistOtpStore(
    data: Record<string, { phone: string; debugOtp: string; expiresAt: number }>
  ): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.customerOtpKey, JSON.stringify(data));
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  private isValidTransition(current: OrderStatus, next: OrderStatus): boolean {
    if (current === next) {
      return true;
    }
    return this.allowedTransitions[current]?.includes(next) ?? false;
  }

  private defaultSettlementStatus(
    mode: DeliveryFeeMode
  ): DeliveryFeeSettlementStatus {
    switch (mode) {
      case 'collect_at_drop':
        return 'pending_collection';
      case 'restaurant_settled':
        return 'restaurant_settled';
      default:
        return 'not_applicable';
    }
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

  async queueWhatsAppConfirmation(
    payload: WhatsAppConfirmationRequest
  ): Promise<WhatsAppConfirmationResponse> {
    return firstValueFrom(
      this.http.post<WhatsAppConfirmationResponse>(
        `${this.baseUrl}/notifications/whatsapp/confirmation`,
        payload
      )
    );
  }

  async confirmDelivery(
    orderId: string,
    payload: DeliveryConfirmationPayload
  ): Promise<OrderRecord | null> {
    try {
      return await firstValueFrom(
        this.http.post<OrderRecord>(
          `${this.baseUrl}/orders/${orderId}/delivery-confirmation`,
          payload
        )
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  requestCustomerLookupOtp(
    payload: CustomerLookupOtpRequest
  ): Promise<CustomerLookupOtpResponse> {
    return firstValueFrom(
      this.http.post<CustomerLookupOtpResponse>(
        `${this.baseUrl}/orders/customer/request-otp`,
        payload
      )
    );
  }

  lookupCustomerOrdersByPhone(
    payload: CustomerOrderLookupRequest
  ): Promise<OrderRecord[]> {
    return firstValueFrom(
      this.http.post<OrderRecord[]>(`${this.baseUrl}/orders/customer/lookup`, payload)
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

  queueWhatsAppConfirmation(
    payload: WhatsAppConfirmationRequest
  ): Promise<WhatsAppConfirmationResponse> {
    return this.adapter.queueWhatsAppConfirmation(payload);
  }

  confirmDelivery(
    orderId: string,
    payload: DeliveryConfirmationPayload
  ): Promise<OrderRecord | null> {
    return this.adapter.confirmDelivery(orderId, payload);
  }

  requestCustomerLookupOtp(
    payload: CustomerLookupOtpRequest
  ): Promise<CustomerLookupOtpResponse> {
    return this.adapter.requestCustomerLookupOtp(payload);
  }

  lookupCustomerOrdersByPhone(
    payload: CustomerOrderLookupRequest
  ): Promise<OrderRecord[]> {
    return this.adapter.lookupCustomerOrdersByPhone(payload);
  }
}

import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { OrderRecord } from '../models/order';
import { CartService } from '../services/cart';
import { OrderApiService } from '../services/order-api';

@Component({
  selector: 'app-my-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './my-orders.html',
  styleUrl: './my-orders.scss',
})
export class MyOrders {
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly statusMessage = signal('');
  readonly foundOrders = signal<OrderRecord[]>([]);
  readonly otpRequested = signal(false);
  readonly otpRequestId = signal('');
  readonly debugOtpHint = signal('');

  phoneInput = '';
  otpInput = '';
  orderIdInput = '';

  constructor(
    private readonly orderApi: OrderApiService,
    private readonly cart: CartService,
    private readonly router: Router
  ) {}

  async requestPhoneOtp(): Promise<void> {
    const digits = this.normalizePhone(this.phoneInput);
    if (digits.length < 10) {
      this.errorMessage.set('Enter a valid phone number.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const response = await this.orderApi.requestCustomerLookupOtp({
        phone: digits,
      });
      this.otpRequested.set(true);
      this.otpRequestId.set(response.requestId);
      this.debugOtpHint.set(response.debugOtp ?? '');
      this.statusMessage.set(
        response.debugOtp
          ? `OTP sent. Demo OTP: ${response.debugOtp}`
          : 'OTP sent to your registered phone number.'
      );
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async verifyPhoneOtpAndSearch(): Promise<void> {
    const digits = this.normalizePhone(this.phoneInput);
    if (digits.length < 10) {
      this.errorMessage.set('Enter a valid phone number.');
      return;
    }
    if (!this.otpRequested() || !this.otpRequestId()) {
      this.errorMessage.set('Request OTP first.');
      return;
    }
    if (!this.otpInput.trim()) {
      this.errorMessage.set('Enter the OTP.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    this.foundOrders.set([]);
    try {
      const matched = await this.orderApi.lookupCustomerOrdersByPhone({
        phone: digits,
        requestId: this.otpRequestId(),
        otpCode: this.otpInput.trim(),
      });
      this.foundOrders.set(matched);
      if (matched.length === 0) {
        this.statusMessage.set('No orders found for this phone number.');
      } else {
        this.statusMessage.set(`Found ${matched.length} order(s).`);
      }
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  resetPhoneLookup(): void {
    this.otpRequested.set(false);
    this.otpRequestId.set('');
    this.debugOtpHint.set('');
    this.otpInput = '';
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.foundOrders.set([]);
  }

  async searchByOrderId(): Promise<void> {
    const orderId = this.orderIdInput.trim();
    if (!orderId) {
      this.errorMessage.set('Enter an order ID.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    this.foundOrders.set([]);
    try {
      const order = await this.orderApi.getOrder(orderId);
      if (!order) {
        this.statusMessage.set('No order found with this ID.');
        return;
      }
      this.foundOrders.set([order]);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async reorder(order: OrderRecord): Promise<void> {
    this.cart.clear();
    for (const item of order.items) {
      this.cart.add(
        {
          id: item.id,
          name: item.name,
          type: item.type,
          image: item.image,
          price: item.price,
          calories: item.calories,
        },
        item.quantity
      );
    }

    this.statusMessage.set(`Items from ${order.orderId} added to cart.`);
    await this.router.navigate(['/cart']);
  }

  statusLabel(status: string): string {
    return status.replace(/_/g, ' ');
  }

  private normalizePhone(value: string): string {
    return value.replace(/\D/g, '');
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

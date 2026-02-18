import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CartService } from '../services/cart';
import { CartItem } from '../services/cart';
import { Payment } from '../services/payment';

type PaymentMethod = 'razorpay' | 'whatsapp';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class Checkout {
  orderPlaced = false;
  isProcessing = false;
  paymentRequested = false;
  paymentMethod: PaymentMethod = 'razorpay';
  statusMessage = '';

  customerName = '';
  customerPhone = '';
  customerEmail = '';
  addressLine = '';
  city = '';
  notes = '';

  confirmedCustomerName = '';
  confirmedCustomerPhone = '';
  confirmedOrderReference = '';
  confirmedTotal = 0;
  confirmedPaymentMode = '';

  private pendingOrderReference = '';

  constructor(
    private readonly cart: CartService,
    private readonly payment: Payment
  ) {}

  items(): CartItem[] {
    return this.cart.items();
  }

  subtotal(): number {
    return this.cart.subtotal();
  }

  deliveryFee(): number {
    return this.items().length > 0 ? 39 : 0;
  }

  tax(): number {
    return Math.round(this.subtotal() * 0.05);
  }

  total(): number {
    return this.subtotal() + this.deliveryFee() + this.tax();
  }

  isFormValid(): boolean {
    return (
      this.customerName.trim().length > 1 &&
      this.customerPhone.replace(/\D/g, '').length >= 10 &&
      this.addressLine.trim().length > 3 &&
      this.city.trim().length > 1
    );
  }

  async startPayment(): Promise<void> {
    if (this.items().length === 0) {
      return;
    }

    if (!this.isFormValid()) {
      this.statusMessage = 'Please complete name, phone, address, and city before payment.';
      return;
    }

    this.statusMessage = '';

    if (this.paymentMethod === 'razorpay') {
      await this.payWithRazorpay();
      return;
    }

    this.sendWhatsAppPaymentRequest();
  }

  async payWithRazorpay(): Promise<void> {
    if (this.payment.razorpayKeyId.includes('replace_with_your_key')) {
      this.statusMessage = 'Add your Razorpay Key ID in payment service before using Razorpay.';
      return;
    }

    this.isProcessing = true;
    const orderReference = this.generateOrderReference();

    try {
      const result = await this.payment.launchRazorpay(
        this.total(),
        {
          name: this.customerName,
          contact: this.customerPhone,
          email: this.customerEmail,
        },
        orderReference
      );

      this.finalizeOrder(orderReference, `Razorpay (${result.paymentId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment failed.';
      this.statusMessage = message;
    } finally {
      this.isProcessing = false;
    }
  }

  sendWhatsAppPaymentRequest(): void {
    this.pendingOrderReference = this.generateOrderReference();
    const url = this.payment.buildWhatsAppPaymentUrl(
      this.customerPhone,
      this.customerName,
      this.pendingOrderReference,
      this.total()
    );

    window.open(url, '_blank');
    this.paymentRequested = true;
    this.statusMessage =
      'WhatsApp payment request opened. After receiving payment proof, click Confirm Order.';
  }

  confirmWhatsAppPayment(): void {
    if (!this.paymentRequested) {
      return;
    }

    this.finalizeOrder(this.pendingOrderReference, 'WhatsApp Pay');
  }

  openCustomerWhatsAppConfirmation(): void {
    const url = this.payment.buildWhatsAppConfirmationUrl(
      this.confirmedCustomerPhone,
      this.confirmedCustomerName,
      this.confirmedOrderReference
    );

    window.open(url, '_blank');
  }

  async copyConfirmationMessage(): Promise<void> {
    const text = this.payment.buildConfirmationMessage(
      this.confirmedCustomerName,
      this.confirmedOrderReference,
      this.confirmedTotal
    );

    try {
      await navigator.clipboard.writeText(text);
      this.statusMessage = 'Confirmation message copied. Share it with the customer on WhatsApp.';
    } catch {
      this.statusMessage = text;
    }
  }

  private finalizeOrder(orderReference: string, paymentMode: string): void {
    this.confirmedOrderReference = orderReference;
    this.confirmedCustomerName = this.customerName;
    this.confirmedCustomerPhone = this.customerPhone;
    this.confirmedTotal = this.total();
    this.confirmedPaymentMode = paymentMode;

    this.orderPlaced = true;
    this.paymentRequested = false;
    this.pendingOrderReference = '';
    this.cart.clear();
  }

  private generateOrderReference(): string {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 900 + 100);
    return `GS-${timestamp}-${random}`;
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CartService } from '../services/cart';
import { CartItem } from '../services/cart';
import { Payment } from '../services/payment';
import { TrackingService } from '../services/tracking';
import { OrderApiService } from '../services/order-api';
import { OrderPaymentMethod } from '../models/order';
import { DeliveryFeeMode } from '../models/order';

type PaymentMethod = OrderPaymentMethod;

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
  deliveryFeeMode: DeliveryFeeMode = 'prepaid';
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
  confirmedDeliveryDue = 0;
  confirmedDeliveryOtp = '';
  trackedOrderId = '';

  private pendingOrderReference = '';

  constructor(
    private readonly cart: CartService,
    private readonly payment: Payment,
    private readonly tracking: TrackingService,
    private readonly orderApi: OrderApiService
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

  payableNow(): number {
    if (this.deliveryFeeMode === 'collect_at_drop') {
      return this.subtotal() + this.tax();
    }
    if (this.deliveryFeeMode === 'restaurant_settled') {
      return this.subtotal() + this.tax();
    }
    return this.total();
  }

  deliveryFeeDueAtDrop(): number {
    return this.deliveryFeeMode === 'collect_at_drop' ? this.deliveryFee() : 0;
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
      const razorpayOrder = await this.orderApi.createRazorpayOrder({
        orderReference,
        amount: this.payableNow(),
        currency: 'INR',
      });

      const checkoutResult = await this.payment.launchRazorpay({
        keyId: razorpayOrder.keyId,
        amountInRupees: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        providerOrderId: razorpayOrder.providerOrderId,
        customer: {
          name: this.customerName,
          contact: this.customerPhone,
          email: this.customerEmail,
        },
        orderReference,
      });

      const verification = await this.orderApi.verifyRazorpayPayment({
        orderReference,
        providerOrderId: checkoutResult.providerOrderId,
        paymentId: checkoutResult.paymentId,
        signature: checkoutResult.signature,
      });

      if (!verification.verified) {
        this.statusMessage = verification.message ?? 'Payment verification failed.';
        return;
      }

      await this.finalizeOrder(
        orderReference,
        'razorpay',
        verification.paymentReference
      );
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
      this.payableNow()
    );

    window.open(url, '_blank');
    this.paymentRequested = true;
    this.statusMessage =
      'WhatsApp payment request opened. After receiving payment proof, click Confirm Order.';
  }

  async confirmWhatsAppPayment(): Promise<void> {
    if (!this.paymentRequested) {
      return;
    }

    await this.finalizeOrder(
      this.pendingOrderReference,
      'whatsapp',
      `manual-${this.pendingOrderReference}`
    );
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

  private async finalizeOrder(
    orderReference: string,
    paymentMethod: OrderPaymentMethod,
    paymentReference: string
  ): Promise<void> {
    const itemSnapshot = this.items().map((item) => ({ ...item }));
    if (itemSnapshot.length === 0) {
      this.statusMessage = 'Cart is empty. Please add items before placing order.';
      return;
    }

    const subtotal = this.subtotal();
    const deliveryFee = this.deliveryFee();
    const tax = this.tax();
    const grandTotal = subtotal + deliveryFee + tax;
    const payableNow = this.payableNow();
    const deliveryFeeDueAtDrop = this.deliveryFeeDueAtDrop();
    const deliveryOtp = this.generateDeliveryOtp();

    try {
      const savedOrder = await this.orderApi.createOrder({
        orderId: orderReference,
        customer: {
          name: this.customerName,
          phone: this.customerPhone,
          email: this.customerEmail || undefined,
        },
        address: {
          line1: this.addressLine,
          city: this.city,
          notes: this.notes || undefined,
        },
        items: itemSnapshot,
        totals: {
          subtotal,
          deliveryFee,
          tax,
          grandTotal,
          payableNow,
          deliveryFeeDueAtDrop,
        },
        paymentMethod,
        paymentReference,
        deliveryFeeMode: this.deliveryFeeMode,
        deliveryFeeSettlementStatus:
          this.deliveryFeeMode === 'collect_at_drop'
            ? 'pending_collection'
            : this.deliveryFeeMode === 'restaurant_settled'
            ? 'restaurant_settled'
            : 'not_applicable',
        deliveryConfirmation: {
          expectedOtp: deliveryOtp,
          otpVerified: false,
        },
      });

      this.confirmedOrderReference = savedOrder.orderId;
      this.confirmedCustomerName = savedOrder.customer.name;
      this.confirmedCustomerPhone = savedOrder.customer.phone;
      this.confirmedTotal = savedOrder.totals.payableNow ?? savedOrder.totals.grandTotal;
      this.confirmedDeliveryDue = savedOrder.totals.deliveryFeeDueAtDrop ?? 0;
      this.confirmedDeliveryOtp = savedOrder.deliveryConfirmation?.expectedOtp ?? deliveryOtp;
      this.confirmedPaymentMode =
        paymentMethod === 'razorpay' ? 'Razorpay' : 'WhatsApp Pay';
      this.trackedOrderId = savedOrder.orderId;

      await this.tracking.createOrderTracking({
        orderId: savedOrder.orderId,
        customerName: savedOrder.customer.name,
        customerPhone: savedOrder.customer.phone,
        addressLine: savedOrder.address.line1,
        city: savedOrder.address.city,
        notes: savedOrder.address.notes ?? '',
        total: savedOrder.totals.grandTotal,
        paymentMode: this.confirmedPaymentMode,
      });

      this.orderPlaced = true;
      this.paymentRequested = false;
      this.pendingOrderReference = '';
      this.cart.clear();
    } catch {
      this.statusMessage = 'Order could not be saved. Please try again.';
    }
  }

  private generateOrderReference(): string {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 900 + 100);
    return `GS-${timestamp}-${random}`;
  }

  private generateDeliveryOtp(): string {
    return `${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

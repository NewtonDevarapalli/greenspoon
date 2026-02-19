import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { CurrencyCode } from '../models/order';

export interface RazorpayCustomer {
  name: string;
  contact: string;
  email: string;
}

export interface RazorpayResult {
  paymentId: string;
  providerOrderId: string;
  signature: string;
}

export interface RazorpayCheckoutRequest {
  keyId: string;
  amountInRupees: number;
  currency: CurrencyCode;
  providerOrderId: string;
  customer: RazorpayCustomer;
  orderReference: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (eventName: string, callback: (response: unknown) => void) => void;
    };
  }
}

@Injectable({
  providedIn: 'root',
})
export class Payment {
  readonly razorpayKeyId = environment.payment.razorpayKeyId;
  readonly upiId = environment.payment.upiId;
  readonly businessName = environment.payment.businessName;

  async launchRazorpay(request: RazorpayCheckoutRequest): Promise<RazorpayResult> {
    await this.ensureRazorpayLoaded();

    if (!window.Razorpay) {
      throw new Error('Razorpay SDK not available.');
    }
    const RazorpayCtor = window.Razorpay;

    return new Promise<RazorpayResult>((resolve, reject) => {
      const razorpay = new RazorpayCtor({
        key: request.keyId,
        amount: Math.round(request.amountInRupees * 100),
        currency: request.currency,
        order_id: request.providerOrderId,
        name: this.businessName,
        description: `Order ${request.orderReference}`,
        image: 'videos/greenspoonlogo.jpeg',
        prefill: {
          name: request.customer.name,
          email: request.customer.email,
          contact: request.customer.contact
        },
        notes: {
          order_reference: request.orderReference
        },
        theme: {
          color: '#1f7a3f'
        },
        handler: (response: {
          razorpay_payment_id?: string;
          razorpay_order_id?: string;
          razorpay_signature?: string;
        }) => {
          if (
            !response.razorpay_payment_id ||
            !response.razorpay_order_id ||
            !response.razorpay_signature
          ) {
            reject(new Error('Incomplete Razorpay payment response.'));
            return;
          }

          resolve({
            paymentId: response.razorpay_payment_id,
            providerOrderId: response.razorpay_order_id,
            signature: response.razorpay_signature,
          });
        }
      });

      razorpay.on('payment.failed', () => {
        reject(new Error('Razorpay payment failed or cancelled.'));
      });

      razorpay.open();
    });
  }

  buildWhatsAppPaymentUrl(
    customerPhone: string,
    customerName: string,
    orderReference: string,
    amountInRupees: number
  ): string {
    const phone = this.normalizePhone(customerPhone);
    const upiLink = `upi://pay?pa=${this.upiId}&pn=${encodeURIComponent(this.businessName)}&am=${amountInRupees.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Order ${orderReference}`)}`;
    const message =
      `Hi ${customerName || 'there'}, your Green Spoon order ${orderReference} is ready for payment.%0A` +
      `Amount: INR ${amountInRupees}%0A` +
      `Pay on UPI: ${upiLink}%0A` +
      `After payment, share screenshot in this chat.`;

    return `https://wa.me/${phone}?text=${message}`;
  }

  buildWhatsAppConfirmationUrl(
    customerPhone: string,
    customerName: string,
    orderReference: string
  ): string {
    const phone = this.normalizePhone(customerPhone);
    const message =
      `Hi ${customerName || 'there'}, your Green Spoon order ${orderReference} has been received successfully.%0A` +
      `Our kitchen team has started preparing it.`;

    return `https://wa.me/${phone}?text=${message}`;
  }

  buildConfirmationMessage(
    customerName: string,
    orderReference: string,
    amountInRupees: number
  ): string {
    return (
      `Hi ${customerName || 'there'}, your Green Spoon order ${orderReference} is received.` +
      ` Total paid: INR ${amountInRupees}. Our kitchen has started preparation.`
    );
  }

  private async ensureRazorpayLoaded(): Promise<void> {
    if (window.Razorpay) {
      return;
    }

    const existingScript = document.querySelector(
      'script[data-razorpay-sdk="true"]'
    );
    if (existingScript) {
      await this.waitForRazorpay();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.dataset['razorpaySdk'] = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Razorpay SDK.'));
      document.body.appendChild(script);
    });

    await this.waitForRazorpay();
  }

  private async waitForRazorpay(): Promise<void> {
    const maxRetries = 20;
    let retries = 0;
    while (!window.Razorpay && retries < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries += 1;
    }

    if (!window.Razorpay) {
      throw new Error('Razorpay SDK not initialized.');
    }
  }

  private normalizePhone(input: string): string {
    const digits = input.replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    if (digits.length === 10) {
      return `91${digits}`;
    }

    return digits;
  }
}

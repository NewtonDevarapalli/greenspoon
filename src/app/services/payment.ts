import { Injectable } from '@angular/core';

export interface RazorpayCustomer {
  name: string;
  contact: string;
  email: string;
}

export interface RazorpayResult {
  paymentId: string;
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
  // Replace these with your production values when ready.
  readonly razorpayKeyId = 'rzp_test_replace_with_your_key';
  readonly upiId = 'greenspoon@upi';
  readonly businessName = 'Green Spoon';

  async launchRazorpay(
    amountInRupees: number,
    customer: RazorpayCustomer,
    orderReference: string
  ): Promise<RazorpayResult> {
    await this.ensureRazorpayLoaded();

    if (!window.Razorpay) {
      throw new Error('Razorpay SDK not available.');
    }
    const RazorpayCtor = window.Razorpay;

    return new Promise<RazorpayResult>((resolve, reject) => {
      const razorpay = new RazorpayCtor({
        key: this.razorpayKeyId,
        amount: Math.round(amountInRupees * 100),
        currency: 'INR',
        name: this.businessName,
        description: `Order ${orderReference}`,
        image: 'videos/greenspoonlogo.jpeg',
        prefill: {
          name: customer.name,
          email: customer.email,
          contact: customer.contact
        },
        notes: {
          order_reference: orderReference
        },
        theme: {
          color: '#1f7a3f'
        },
        handler: (response: { razorpay_payment_id?: string }) => {
          resolve({ paymentId: response.razorpay_payment_id ?? 'paid' });
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

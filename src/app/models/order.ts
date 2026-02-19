export type OrderStatus =
  | 'created'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type OrderPaymentMethod = 'razorpay' | 'whatsapp';
export type CurrencyCode = 'INR';

export interface OrderCustomerInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface OrderAddress {
  line1: string;
  city: string;
  notes?: string;
}

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  tax: number;
  grandTotal: number;
}

export interface OrderItem {
  id: string;
  name: string;
  type: string;
  image: string;
  price: number;
  calories: string;
  quantity: number;
}

export interface OrderCreatePayload {
  orderId: string;
  customer: OrderCustomerInfo;
  address: OrderAddress;
  items: OrderItem[];
  totals: OrderTotals;
  paymentMethod: OrderPaymentMethod;
  paymentReference: string;
}

export interface OrderRecord extends OrderCreatePayload {
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface RazorpayOrderCreatePayload {
  orderReference: string;
  amount: number;
  currency: CurrencyCode;
}

export interface RazorpayOrderResponse {
  provider: 'razorpay';
  providerOrderId: string;
  amount: number;
  currency: CurrencyCode;
  keyId: string;
}

export interface RazorpayVerifyPayload {
  orderReference: string;
  providerOrderId: string;
  paymentId: string;
  signature: string;
}

export interface RazorpayVerifyResponse {
  verified: boolean;
  paymentReference: string;
  message?: string;
}

export interface WhatsAppConfirmationRequest {
  orderId: string;
  customerName: string;
  customerPhone: string;
  message: string;
}

export interface WhatsAppConfirmationResponse {
  queued: boolean;
  channel: 'whatsapp';
  providerMessageId?: string;
}

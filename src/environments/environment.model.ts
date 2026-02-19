export type OrderApiMode = 'local' | 'http';

export interface AppEnvironment {
  production: boolean;
  api: {
    baseUrl: string;
    orderApiMode: OrderApiMode;
  };
  payment: {
    razorpayKeyId: string;
    businessName: string;
    upiId: string;
  };
}

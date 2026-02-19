import { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: false,
  api: {
    baseUrl: 'http://localhost:3000',
    orderApiMode: 'http',
  },
  payment: {
    razorpayKeyId: 'rzp_test_replace_with_your_key',
    businessName: 'Green Spoon',
    upiId: 'greenspoon@upi',
  },
};

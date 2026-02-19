import { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: true,
  api: {
    baseUrl: 'https://api.greenspoonfoods.com',
    orderApiMode: 'local',
  },
  payment: {
    razorpayKeyId: 'rzp_live_replace_with_your_key',
    businessName: 'Green Spoon',
    upiId: 'greenspoon@upi',
  },
};

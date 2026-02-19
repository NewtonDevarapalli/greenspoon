export type SubscriptionPlan = 'monthly' | 'quarterly' | 'yearly';

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled';

export interface SubscriptionPlanCatalogItem {
  plan: SubscriptionPlan;
  durationDays: number;
  amount: number;
  currency: 'INR';
}

export interface TenantSubscription {
  tenantId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  amount: number;
  currency: 'INR';
  startAt: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  updatedAt: number;
}

export interface TenantRecord {
  tenantId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface TenantWithSubscription extends TenantRecord {
  subscription: TenantSubscription | null;
}

export interface TenantCreatePayload {
  tenantId: string;
  name: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
}

export interface TenantSubscriptionUpdatePayload {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startAt?: number;
}

export interface TenantSubscriptionStatusUpdatePayload {
  status: SubscriptionStatus;
}

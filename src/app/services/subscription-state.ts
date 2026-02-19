import { Injectable, signal } from '@angular/core';

export interface SubscriptionBlockState {
  tenantId?: string;
  subscriptionStatus?: string;
  currentPeriodEnd?: number | null;
  message: string;
  detectedAt: number;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionStateService {
  private readonly blockStateSignal = signal<SubscriptionBlockState | null>(null);

  readonly blockState = this.blockStateSignal.asReadonly();

  setBlocked(state: Omit<SubscriptionBlockState, 'detectedAt'>): void {
    this.blockStateSignal.set({
      ...state,
      detectedAt: Date.now(),
    });
  }

  clear(): void {
    this.blockStateSignal.set(null);
  }
}

import { HttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  SubscriptionPlanCatalogItem,
  TenantCreatePayload,
  TenantSubscription,
  TenantSubscriptionStatusUpdatePayload,
  TenantSubscriptionUpdatePayload,
  TenantWithSubscription,
} from '../models/tenant';

interface TenantApiAdapter {
  listPlans(): Promise<SubscriptionPlanCatalogItem[]>;
  listTenants(): Promise<TenantWithSubscription[]>;
  createTenant(payload: TenantCreatePayload): Promise<TenantWithSubscription>;
  getTenantSubscription(tenantId: string): Promise<TenantSubscription | null>;
  updateTenantSubscription(
    tenantId: string,
    payload: TenantSubscriptionUpdatePayload
  ): Promise<TenantSubscription | null>;
  updateTenantSubscriptionStatus(
    tenantId: string,
    payload: TenantSubscriptionStatusUpdatePayload
  ): Promise<TenantSubscription | null>;
}

@Injectable({ providedIn: 'root' })
export class LocalTenantApiService implements TenantApiAdapter {
  private readonly storageKey = 'greenspoon-tenants-v1';
  private readonly defaultPlans: SubscriptionPlanCatalogItem[] = [
    { plan: 'monthly', durationDays: 30, amount: 4999, currency: 'INR' },
    { plan: 'quarterly', durationDays: 90, amount: 13999, currency: 'INR' },
    { plan: 'yearly', durationDays: 365, amount: 49999, currency: 'INR' },
  ];

  async listPlans(): Promise<SubscriptionPlanCatalogItem[]> {
    return [...this.defaultPlans];
  }

  async listTenants(): Promise<TenantWithSubscription[]> {
    const data = this.readAll();
    return Object.values(data).sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  }

  async createTenant(payload: TenantCreatePayload): Promise<TenantWithSubscription> {
    const all = this.readAll();
    if (all[payload.tenantId]) {
      throw new Error('tenantId already exists.');
    }

    const now = Date.now();
    const plan = this.defaultPlans.find((item) => item.plan === payload.plan) ?? this.defaultPlans[0];
    const created: TenantWithSubscription = {
      tenantId: payload.tenantId,
      name: payload.name,
      createdAt: now,
      updatedAt: now,
      subscription: {
        tenantId: payload.tenantId,
        plan: plan.plan,
        status: payload.status,
        amount: plan.amount,
        currency: plan.currency,
        startAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: now + plan.durationDays * 24 * 60 * 60 * 1000,
        updatedAt: now,
      },
    };

    all[payload.tenantId] = created;
    this.persistAll(all);
    return created;
  }

  async getTenantSubscription(tenantId: string): Promise<TenantSubscription | null> {
    const all = this.readAll();
    return all[tenantId]?.subscription ?? null;
  }

  async updateTenantSubscription(
    tenantId: string,
    payload: TenantSubscriptionUpdatePayload
  ): Promise<TenantSubscription | null> {
    const all = this.readAll();
    const existing = all[tenantId];
    if (!existing?.subscription) {
      return null;
    }

    const now = Date.now();
    const plan = this.defaultPlans.find((item) => item.plan === payload.plan) ?? this.defaultPlans[0];
    const startAt = payload.startAt ?? now;
    const next: TenantSubscription = {
      ...existing.subscription,
      plan: payload.plan,
      status: payload.status,
      amount: plan.amount,
      currency: plan.currency,
      startAt,
      currentPeriodStart: startAt,
      currentPeriodEnd: startAt + plan.durationDays * 24 * 60 * 60 * 1000,
      updatedAt: now,
    };

    all[tenantId] = {
      ...existing,
      updatedAt: now,
      subscription: next,
    };
    this.persistAll(all);
    return next;
  }

  async updateTenantSubscriptionStatus(
    tenantId: string,
    payload: TenantSubscriptionStatusUpdatePayload
  ): Promise<TenantSubscription | null> {
    const all = this.readAll();
    const existing = all[tenantId];
    if (!existing?.subscription) {
      return null;
    }

    const now = Date.now();
    const next: TenantSubscription = {
      ...existing.subscription,
      status: payload.status,
      updatedAt: now,
    };
    all[tenantId] = {
      ...existing,
      updatedAt: now,
      subscription: next,
    };
    this.persistAll(all);
    return next;
  }

  private readAll(): Record<string, TenantWithSubscription> {
    try {
      if (!this.canUseStorage()) {
        return {};
      }
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, TenantWithSubscription>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistAll(data: Record<string, TenantWithSubscription>): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }
}

@Injectable({ providedIn: 'root' })
export class HttpTenantApiService implements TenantApiAdapter {
  private readonly baseUrl = environment.api.baseUrl;

  constructor(private readonly http: HttpClient) {}

  listPlans(): Promise<SubscriptionPlanCatalogItem[]> {
    return firstValueFrom(
      this.http.get<SubscriptionPlanCatalogItem[]>(`${this.baseUrl}/subscriptions/plans`)
    );
  }

  listTenants(): Promise<TenantWithSubscription[]> {
    return firstValueFrom(this.http.get<TenantWithSubscription[]>(`${this.baseUrl}/tenants`));
  }

  createTenant(payload: TenantCreatePayload): Promise<TenantWithSubscription> {
    return firstValueFrom(
      this.http.post<TenantWithSubscription>(`${this.baseUrl}/tenants`, payload)
    );
  }

  async getTenantSubscription(tenantId: string): Promise<TenantSubscription | null> {
    try {
      return await firstValueFrom(
        this.http.get<TenantSubscription>(
          `${this.baseUrl}/tenants/${encodeURIComponent(tenantId)}/subscription`
        )
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async updateTenantSubscription(
    tenantId: string,
    payload: TenantSubscriptionUpdatePayload
  ): Promise<TenantSubscription | null> {
    try {
      return await firstValueFrom(
        this.http.put<TenantSubscription>(
          `${this.baseUrl}/tenants/${encodeURIComponent(tenantId)}/subscription`,
          payload
        )
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async updateTenantSubscriptionStatus(
    tenantId: string,
    payload: TenantSubscriptionStatusUpdatePayload
  ): Promise<TenantSubscription | null> {
    try {
      return await firstValueFrom(
        this.http.patch<TenantSubscription>(
          `${this.baseUrl}/tenants/${encodeURIComponent(tenantId)}/subscription/status`,
          payload
        )
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 404;
  }
}

@Injectable({ providedIn: 'root' })
export class TenantApiService implements TenantApiAdapter {
  private readonly adapter: TenantApiAdapter;

  constructor(
    private readonly local: LocalTenantApiService,
    private readonly remote: HttpTenantApiService
  ) {
    this.adapter = environment.api.orderApiMode === 'http' ? this.remote : this.local;
  }

  listPlans(): Promise<SubscriptionPlanCatalogItem[]> {
    return this.adapter.listPlans();
  }

  listTenants(): Promise<TenantWithSubscription[]> {
    return this.adapter.listTenants();
  }

  createTenant(payload: TenantCreatePayload): Promise<TenantWithSubscription> {
    return this.adapter.createTenant(payload);
  }

  getTenantSubscription(tenantId: string): Promise<TenantSubscription | null> {
    return this.adapter.getTenantSubscription(tenantId);
  }

  updateTenantSubscription(
    tenantId: string,
    payload: TenantSubscriptionUpdatePayload
  ): Promise<TenantSubscription | null> {
    return this.adapter.updateTenantSubscription(tenantId, payload);
  }

  updateTenantSubscriptionStatus(
    tenantId: string,
    payload: TenantSubscriptionStatusUpdatePayload
  ): Promise<TenantSubscription | null> {
    return this.adapter.updateTenantSubscriptionStatus(tenantId, payload);
  }
}

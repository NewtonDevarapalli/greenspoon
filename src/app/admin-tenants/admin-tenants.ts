import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SubscriptionPlan,
  SubscriptionPlanCatalogItem,
  SubscriptionStatus,
  TenantWithSubscription,
} from '../models/tenant';
import { TenantApiService } from '../services/tenant-api';

interface SubscriptionDraft {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
}

@Component({
  selector: 'app-admin-tenants',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-tenants.html',
  styleUrl: './admin-tenants.scss',
})
export class AdminTenants implements OnInit {
  readonly loading = signal(true);
  readonly busyCreate = signal(false);
  readonly busySaveTenant = signal('');
  readonly statusMessage = signal('');
  readonly errorMessage = signal('');
  readonly plans = signal<SubscriptionPlanCatalogItem[]>([]);
  readonly tenants = signal<TenantWithSubscription[]>([]);

  tenantIdInput = '';
  tenantNameInput = '';
  tenantPlanInput: SubscriptionPlan = 'monthly';
  tenantStatusInput: SubscriptionStatus = 'trial';

  readonly statusOptions: SubscriptionStatus[] = [
    'trial',
    'active',
    'past_due',
    'suspended',
    'cancelled',
  ];

  private readonly drafts: Record<string, SubscriptionDraft> = {};

  constructor(private readonly tenantApi: TenantApiService) {}

  ngOnInit(): void {
    void this.loadData();
  }

  async refresh(): Promise<void> {
    await this.loadData();
  }

  draft(tenantId: string): SubscriptionDraft {
    if (!this.drafts[tenantId]) {
      const tenant = this.tenants().find((entry) => entry.tenantId === tenantId);
      this.drafts[tenantId] = {
        plan: tenant?.subscription?.plan ?? this.tenantPlanInput,
        status: tenant?.subscription?.status ?? this.tenantStatusInput,
      };
    }
    return this.drafts[tenantId];
  }

  async createTenant(): Promise<void> {
    const tenantId = this.tenantIdInput.trim();
    const name = this.tenantNameInput.trim();
    if (!tenantId || !name) {
      this.errorMessage.set('Tenant ID and name are required.');
      return;
    }

    this.busyCreate.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const created = await this.tenantApi.createTenant({
        tenantId,
        name,
        plan: this.tenantPlanInput,
        status: this.tenantStatusInput,
      });
      this.tenants.update((list) =>
        [...list, created].sort((a, b) => a.tenantId.localeCompare(b.tenantId))
      );
      this.drafts[created.tenantId] = {
        plan: created.subscription?.plan ?? this.tenantPlanInput,
        status: created.subscription?.status ?? this.tenantStatusInput,
      };
      this.tenantIdInput = '';
      this.tenantNameInput = '';
      this.tenantPlanInput = 'monthly';
      this.tenantStatusInput = 'trial';
      this.statusMessage.set(`Tenant ${created.tenantId} created.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyCreate.set(false);
    }
  }

  async saveSubscription(tenant: TenantWithSubscription): Promise<void> {
    const draft = this.draft(tenant.tenantId);
    this.busySaveTenant.set(tenant.tenantId);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const updated = await this.tenantApi.updateTenantSubscription(tenant.tenantId, {
        plan: draft.plan,
        status: draft.status,
      });
      if (!updated) {
        this.errorMessage.set('Subscription not found for this tenant.');
        return;
      }
      this.tenants.update((list) =>
        list.map((entry) =>
          entry.tenantId === tenant.tenantId
            ? {
                ...entry,
                subscription: updated,
                updatedAt: Date.now(),
              }
            : entry
        )
      );
      this.statusMessage.set(`Subscription updated for ${tenant.tenantId}.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busySaveTenant.set('');
    }
  }

  async setStatus(tenant: TenantWithSubscription, status: SubscriptionStatus): Promise<void> {
    this.busySaveTenant.set(tenant.tenantId);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const updated = await this.tenantApi.updateTenantSubscriptionStatus(tenant.tenantId, {
        status,
      });
      if (!updated) {
        this.errorMessage.set('Subscription not found for this tenant.');
        return;
      }
      this.draft(tenant.tenantId).status = updated.status;
      this.tenants.update((list) =>
        list.map((entry) =>
          entry.tenantId === tenant.tenantId
            ? {
                ...entry,
                subscription: updated,
                updatedAt: Date.now(),
              }
            : entry
        )
      );
      this.statusMessage.set(`Status updated to ${updated.status} for ${tenant.tenantId}.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busySaveTenant.set('');
    }
  }

  planLabel(plan: SubscriptionPlan): string {
    switch (plan) {
      case 'monthly':
        return 'Monthly';
      case 'quarterly':
        return 'Quarterly';
      case 'yearly':
        return 'Yearly';
      default:
        return plan;
    }
  }

  statusLabel(status: SubscriptionStatus): string {
    return status.replace('_', ' ');
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const [plans, tenants] = await Promise.all([
        this.tenantApi.listPlans(),
        this.tenantApi.listTenants(),
      ]);
      this.plans.set(plans);
      this.tenants.set(tenants);
      for (const tenant of tenants) {
        this.drafts[tenant.tenantId] = {
          plan: tenant.subscription?.plan ?? 'monthly',
          status: tenant.subscription?.status ?? 'trial',
        };
      }
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error?.message === 'string') {
        return error.error.message;
      }
      return `Request failed with status ${error.status}.`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unexpected error. Please try again.';
  }
}

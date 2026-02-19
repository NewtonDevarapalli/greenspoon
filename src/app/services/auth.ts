import { Injectable, signal } from '@angular/core';
import { AuthSession, AppRole } from '../models/auth';

interface AuthUserCredential {
  userId: string;
  email: string;
  password: string;
  name: string;
  role: AppRole;
  tenantId: string;
}

export interface LoginResult {
  ok: boolean;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'greenspoon-auth-v1';
  private readonly sessionSignal = signal<AuthSession | null>(this.readSession());

  readonly session = this.sessionSignal.asReadonly();

  private readonly users: AuthUserCredential[] = [
    {
      userId: 'u-platform-admin',
      email: 'admin@greenspoon.com',
      password: 'Admin@123',
      name: 'Platform Admin',
      role: 'platform_admin',
      tenantId: 'greenspoon-platform',
    },
    {
      userId: 'u-owner',
      email: 'owner@greenspoon.com',
      password: 'Owner@123',
      name: 'Restaurant Owner',
      role: 'restaurant_owner',
      tenantId: 'greenspoon-demo-tenant',
    },
    {
      userId: 'u-manager',
      email: 'manager@greenspoon.com',
      password: 'Manager@123',
      name: 'Kitchen Manager',
      role: 'manager',
      tenantId: 'greenspoon-demo-tenant',
    },
    {
      userId: 'u-dispatch',
      email: 'dispatch@greenspoon.com',
      password: 'Dispatch@123',
      name: 'Dispatch Lead',
      role: 'dispatch',
      tenantId: 'greenspoon-demo-tenant',
    },
    {
      userId: 'u-customer',
      email: 'customer@greenspoon.com',
      password: 'Customer@123',
      name: 'Green Spoon Customer',
      role: 'customer',
      tenantId: 'greenspoon-demo-tenant',
    },
  ];

  login(email: string, password: string): LoginResult {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.users.find(
      (entry) => entry.email.toLowerCase() === normalizedEmail
    );

    if (!user || user.password !== password) {
      return { ok: false, message: 'Invalid email or password.' };
    }

    const session: AuthSession = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      loginAt: Date.now(),
    };

    this.sessionSignal.set(session);
    this.persistSession(session);

    return { ok: true };
  }

  logout(): void {
    this.sessionSignal.set(null);
    if (this.canUseStorage()) {
      localStorage.removeItem(this.storageKey);
    }
  }

  isAuthenticated(): boolean {
    return this.sessionSignal() !== null;
  }

  hasAnyRole(roles: AppRole[]): boolean {
    const current = this.sessionSignal();
    if (!current) {
      return false;
    }
    return roles.includes(current.role);
  }

  private persistSession(session: AuthSession): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(session));
  }

  private readSession(): AuthSession | null {
    try {
      if (!this.canUseStorage()) {
        return null;
      }
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as AuthSession;
      if (
        typeof parsed?.userId !== 'string' ||
        typeof parsed?.email !== 'string' ||
        typeof parsed?.name !== 'string' ||
        typeof parsed?.role !== 'string' ||
        typeof parsed?.tenantId !== 'string' ||
        typeof parsed?.loginAt !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }
}

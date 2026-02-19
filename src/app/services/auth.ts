import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AppRole, AuthSession } from '../models/auth';

interface AuthUserCredential {
  userId: string;
  email: string;
  password: string;
  name: string;
  role: AppRole;
  tenantId: string;
}

interface AuthUserDto {
  userId: string;
  email: string;
  name: string;
  role: AppRole;
  tenantId: string;
}

interface AuthLoginResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: string;
  refreshToken: string;
  user: AuthUserDto;
}

interface AuthRefreshResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: string;
  user: AuthUserDto;
}

export interface LoginResult {
  ok: boolean;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'greenspoon-auth-v2';
  private readonly authApiPrefix = `${environment.api.baseUrl}/auth/`;
  private readonly sessionSignal = signal<AuthSession | null>(this.readSession());
  private readonly rawHttp: HttpClient;
  private refreshInFlight: Promise<boolean> | null = null;

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

  constructor(httpBackend: HttpBackend) {
    this.rawHttp = new HttpClient(httpBackend);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    return this.useRemoteAuth()
      ? this.loginRemote(email, password)
      : this.loginLocal(email, password);
  }

  async logout(): Promise<void> {
    const current = this.sessionSignal();
    if (
      this.useRemoteAuth() &&
      current?.accessToken &&
      isNonEmptyString(current.refreshToken)
    ) {
      try {
        await firstValueFrom(
          this.rawHttp.post(
            `${environment.api.baseUrl}/auth/logout`,
            { refreshToken: current.refreshToken },
            {
              headers: {
                Authorization: `Bearer ${current.accessToken}`,
              },
            }
          )
        );
      } catch {
        // Ignore logout API errors and clear local session.
      }
    }

    this.clearSession();
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

  accessToken(): string {
    return this.sessionSignal()?.accessToken ?? '';
  }

  shouldAttachToken(url: string): boolean {
    if (!this.useRemoteAuth()) {
      return false;
    }
    if (!url.startsWith(environment.api.baseUrl)) {
      return false;
    }
    return !this.isAuthApiUrl(url);
  }

  async refreshAccessToken(): Promise<boolean> {
    if (!this.useRemoteAuth()) {
      return false;
    }

    const current = this.sessionSignal();
    if (!isNonEmptyString(current?.refreshToken)) {
      this.clearSession();
      return false;
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshRemote(current.refreshToken).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async loginRemote(email: string, password: string): Promise<LoginResult> {
    try {
      const response = await firstValueFrom(
        this.rawHttp.post<AuthLoginResponse>(
          `${environment.api.baseUrl}/auth/login`,
          {
            email: email.trim(),
            password,
          }
        )
      );

      const nextSession: AuthSession = {
        ...this.mapUser(response.user),
        loginAt: Date.now(),
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        tokenType: response.tokenType ?? 'Bearer',
        expiresIn: response.expiresIn ?? '',
        authMode: 'http',
      };

      this.setSession(nextSession);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: this.extractHttpErrorMessage(error, 'Invalid email or password.'),
      };
    }
  }

  private loginLocal(email: string, password: string): LoginResult {
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
      authMode: 'local',
    };

    this.setSession(session);
    return { ok: true };
  }

  private async refreshRemote(refreshToken: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.rawHttp.post<AuthRefreshResponse>(
          `${environment.api.baseUrl}/auth/refresh`,
          { refreshToken }
        )
      );

      const current = this.sessionSignal();
      const nextSession: AuthSession = {
        ...this.mapUser(response.user),
        loginAt: Date.now(),
        accessToken: response.accessToken,
        refreshToken,
        tokenType: response.tokenType ?? current?.tokenType ?? 'Bearer',
        expiresIn: response.expiresIn ?? current?.expiresIn ?? '',
        authMode: 'http',
      };

      this.setSession(nextSession);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  private useRemoteAuth(): boolean {
    return environment.api.orderApiMode === 'http';
  }

  private isAuthApiUrl(url: string): boolean {
    return url.startsWith(this.authApiPrefix);
  }

  private setSession(session: AuthSession): void {
    this.sessionSignal.set(session);
    this.persistSession(session);
  }

  private clearSession(): void {
    this.sessionSignal.set(null);
    if (this.canUseStorage()) {
      localStorage.removeItem(this.storageKey);
    }
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

      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      const loginAt = typeof parsed.loginAt === 'number' ? parsed.loginAt : NaN;
      if (
        !isNonEmptyString(parsed.userId) ||
        !isNonEmptyString(parsed.email) ||
        !isNonEmptyString(parsed.name) ||
        !isAppRole(parsed.role) ||
        !isNonEmptyString(parsed.tenantId) ||
        !Number.isFinite(loginAt)
      ) {
        return null;
      }

      return {
        userId: parsed.userId,
        email: parsed.email,
        name: parsed.name,
        role: parsed.role,
        tenantId: parsed.tenantId,
        loginAt,
        accessToken: isNonEmptyString(parsed.accessToken) ? parsed.accessToken : undefined,
        refreshToken: isNonEmptyString(parsed.refreshToken) ? parsed.refreshToken : undefined,
        tokenType: isNonEmptyString(parsed.tokenType) ? parsed.tokenType : undefined,
        expiresIn: isNonEmptyString(parsed.expiresIn) ? parsed.expiresIn : undefined,
        authMode: parsed.authMode === 'http' ? 'http' : 'local',
      };
    } catch {
      return null;
    }
  }

  private mapUser(user: AuthUserDto): Pick<AuthSession, 'userId' | 'email' | 'name' | 'role' | 'tenantId'> {
    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    };
  }

  private extractHttpErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null) {
      const maybeError = error as { error?: { message?: string } };
      if (isNonEmptyString(maybeError.error?.message)) {
        return maybeError.error.message;
      }
    }
    return fallback;
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAppRole(value: unknown): value is AppRole {
  return (
    value === 'platform_admin' ||
    value === 'restaurant_owner' ||
    value === 'manager' ||
    value === 'dispatch' ||
    value === 'kitchen' ||
    value === 'rider' ||
    value === 'customer'
  );
}

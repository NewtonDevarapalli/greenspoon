import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AppRole } from '../models/auth';
import { AuthService } from '../services/auth';

interface DemoAccount {
  label: string;
  email: string;
  password: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  readonly demoAccounts: DemoAccount[] = [
    {
      label: 'Platform Admin',
      email: 'admin@greenspoon.com',
      password: 'Admin@123',
    },
    {
      label: 'Owner',
      email: 'owner@greenspoon.com',
      password: 'Owner@123',
    },
    {
      label: 'Manager',
      email: 'manager@greenspoon.com',
      password: 'Manager@123',
    },
    {
      label: 'Dispatch',
      email: 'dispatch@greenspoon.com',
      password: 'Dispatch@123',
    },
    {
      label: 'Customer',
      email: 'customer@greenspoon.com',
      password: 'Customer@123',
    },
  ];

  email = '';
  password = '';
  isSubmitting = false;
  errorMessage = '';
  infoMessage = '';

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {
    if (this.auth.isAuthenticated()) {
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      void this.router.navigateByUrl(returnUrl);
      return;
    }

    const reason = this.route.snapshot.queryParamMap.get('reason');
    if (reason === 'forbidden') {
      this.infoMessage = 'Your account does not have permission for that page.';
    } else if (reason === 'session_expired') {
      this.infoMessage = 'Your session expired. Please sign in again.';
    }
  }

  async submit(): Promise<void> {
    this.errorMessage = '';
    this.infoMessage = '';

    if (!this.email.trim() || !this.password.trim()) {
      this.errorMessage = 'Email and password are required.';
      return;
    }

    this.isSubmitting = true;
    try {
      const result = await this.auth.login(this.email, this.password);
      if (!result.ok) {
        this.errorMessage = result.message || 'Login failed.';
        return;
      }

      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (returnUrl) {
        await this.router.navigateByUrl(returnUrl);
        return;
      }

      await this.router.navigateByUrl(this.resolveLandingUrl());
    } finally {
      this.isSubmitting = false;
    }
  }

  useDemo(account: DemoAccount): void {
    this.email = account.email;
    this.password = account.password;
    this.errorMessage = '';
  }

  private resolveLandingUrl(): string {
    const role = this.auth.session()?.role;
    if (!role) {
      return '/';
    }

    if (role === 'dispatch') {
      return '/admin/dispatch';
    }

    if (this.canAccessAdminOrders(role)) {
      return '/admin/orders';
    }

    return '/';
  }

  private canAccessAdminOrders(role: AppRole): boolean {
    return ['platform_admin', 'restaurant_owner', 'manager'].includes(role);
  }
}

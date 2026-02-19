import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Router } from '@angular/router';
import { CartService } from '../services/cart';
import { AuthService } from '../services/auth';
import { AppRole } from '../models/auth';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header {
  constructor(
    private readonly cart: CartService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  cartCount(): number {
    return this.cart.itemCount();
  }

  isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  canAccessAdmin(): boolean {
    return this.auth.hasAnyRole(['platform_admin', 'restaurant_owner', 'manager']);
  }

  canAccessTenantOps(): boolean {
    return this.auth.hasAnyRole(['platform_admin']);
  }

  canAccessDispatch(): boolean {
    return this.auth.hasAnyRole([
      'platform_admin',
      'restaurant_owner',
      'manager',
      'dispatch',
    ]);
  }

  showMyOrders(): boolean {
    const session = this.auth.session();
    if (!session) {
      return true;
    }
    return session.role === 'customer';
  }

  currentUserName(): string {
    return this.auth.session()?.name ?? '';
  }

  currentRoleLabel(): string {
    const role = this.auth.session()?.role;
    return role ? this.roleLabel(role) : '';
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/']);
  }

  private roleLabel(role: AppRole): string {
    switch (role) {
      case 'platform_admin':
        return 'Platform Admin';
      case 'restaurant_owner':
        return 'Owner';
      case 'manager':
        return 'Manager';
      case 'dispatch':
        return 'Dispatch';
      case 'kitchen':
        return 'Kitchen';
      case 'rider':
        return 'Rider';
      case 'customer':
        return 'Customer';
      default:
        return role;
    }
  }
}

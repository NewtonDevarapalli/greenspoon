import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth';
import { SubscriptionStateService } from '../services/subscription-state';

@Component({
  selector: 'app-subscription-blocked',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './subscription-blocked.html',
  styleUrl: './subscription-blocked.scss',
})
export class SubscriptionBlocked {
  constructor(
    private readonly subscriptionState: SubscriptionStateService,
    private readonly auth: AuthService
  ) {}

  state() {
    return this.subscriptionState.blockState();
  }

  isPlatformAdmin(): boolean {
    return this.auth.hasAnyRole(['platform_admin']);
  }

  clearState(): void {
    this.subscriptionState.clear();
  }
}

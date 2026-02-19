import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TrackingService } from '../services/tracking';
import { TrackingOrder } from '../services/tracking';

@Component({
  selector: 'app-tracking',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tracking.html',
  styleUrl: './tracking.scss',
})
export class Tracking {
  private readonly orderId = signal('');

  readonly order = computed(() => {
    const id = this.orderId();
    if (!id) {
      return null;
    }
    return this.tracking.getOrder(id);
  });

  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const data = this.order();
    if (!data) {
      return null;
    }

    const url = `https://maps.google.com/maps?q=${data.current.lat},${data.current.lng}&z=15&output=embed`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly tracking: TrackingService,
    private readonly sanitizer: DomSanitizer
  ) {
    this.orderId.set(this.route.snapshot.paramMap.get('orderId') ?? '');
    this.route.paramMap.subscribe((params) => {
      this.orderId.set(params.get('orderId') ?? '');
    });
  }

  progress(order: TrackingOrder): number {
    return this.tracking.progressPercent(order);
  }

  statusLabel(order: TrackingOrder): string {
    return this.tracking.statusLabel(order.status);
  }
}

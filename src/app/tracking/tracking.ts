import { Component, OnDestroy, computed, signal } from '@angular/core';
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
export class Tracking implements OnDestroy {
  private readonly orderId = signal('');
  readonly order = signal<TrackingOrder | null>(null);
  readonly loading = signal(true);
  private stopWatch: (() => void) | null = null;

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
    const initialId = this.route.snapshot.paramMap.get('orderId') ?? '';
    this.orderId.set(initialId);
    void this.loadOrder(initialId);

    this.route.paramMap.subscribe((params) => {
      const id = params.get('orderId') ?? '';
      this.orderId.set(id);
      void this.loadOrder(id);
    });
  }

  progress(order: TrackingOrder): number {
    return this.tracking.progressPercent(order);
  }

  statusLabel(order: TrackingOrder): string {
    return this.tracking.statusLabel(order.status);
  }

  ngOnDestroy(): void {
    if (this.stopWatch) {
      this.stopWatch();
      this.stopWatch = null;
    }
  }

  private async loadOrder(orderId: string): Promise<void> {
    if (this.stopWatch) {
      this.stopWatch();
      this.stopWatch = null;
    }

    if (!orderId) {
      this.order.set(null);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    try {
      const current = await this.tracking.getOrder(orderId);
      this.order.set(current);

      this.stopWatch = this.tracking.watchOrder(orderId, (next) => {
        this.order.set(next);
      });
    } catch {
      this.order.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}

import { Injectable, signal } from '@angular/core';

export type DeliveryStatus =
  | 'assigned'
  | 'picked_up'
  | 'on_the_way'
  | 'nearby'
  | 'delivered';

export interface DeliveryPoint {
  lat: number;
  lng: number;
}

export interface DeliveryEvent {
  status: DeliveryStatus;
  label: string;
  time: number;
}

export interface TrackingOrder {
  orderId: string;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  city: string;
  notes: string;
  total: number;
  paymentMode: string;
  status: DeliveryStatus;
  agentName: string;
  agentPhone: string;
  route: DeliveryPoint[];
  progressIndex: number;
  current: DeliveryPoint;
  etaMinutes: number;
  createdAt: number;
  updatedAt: number;
  events: DeliveryEvent[];
}

export interface NewTrackingOrder {
  orderId: string;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  city: string;
  notes: string;
  total: number;
  paymentMode: string;
}

@Injectable({ providedIn: 'root' })
export class TrackingService {
  private readonly storageKey = 'greenspoon-live-tracking-v1';
  private readonly ordersSignal = signal<Record<string, TrackingOrder>>(
    this.readFromStorage()
  );
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  readonly orders = this.ordersSignal.asReadonly();

  constructor() {
    this.resumeActiveTracking();
  }

  createOrderTracking(payload: NewTrackingOrder): TrackingOrder {
    const existing = this.ordersSignal()[payload.orderId];
    if (existing) {
      if (existing.status !== 'delivered') {
        this.startTicker(existing.orderId);
      }
      return existing;
    }

    const destination = this.resolveDestination(payload.city);
    const origin = this.resolveOrigin(payload.city);
    const route = this.buildRoute(origin, destination, 14);
    const now = Date.now();
    const agent = this.pickAgent();

    const order: TrackingOrder = {
      ...payload,
      status: 'assigned',
      agentName: agent.name,
      agentPhone: agent.phone,
      route,
      progressIndex: 0,
      current: route[0],
      etaMinutes: (route.length - 1) * 4,
      createdAt: now,
      updatedAt: now,
      events: [{ status: 'assigned', label: this.statusLabel('assigned'), time: now }],
    };

    this.ordersSignal.update((current) => ({
      ...current,
      [order.orderId]: order,
    }));
    this.persist();
    this.startTicker(order.orderId);
    return order;
  }

  getOrder(orderId: string): TrackingOrder | null {
    return this.ordersSignal()[orderId] ?? null;
  }

  statusLabel(status: DeliveryStatus): string {
    switch (status) {
      case 'assigned':
        return 'Delivery agent assigned';
      case 'picked_up':
        return 'Order picked up from kitchen';
      case 'on_the_way':
        return 'Rider is on the way';
      case 'nearby':
        return 'Rider is near your location';
      case 'delivered':
        return 'Order delivered';
      default:
        return 'Tracking update';
    }
  }

  progressPercent(order: TrackingOrder): number {
    const totalSteps = Math.max(1, order.route.length - 1);
    return Math.round((order.progressIndex / totalSteps) * 100);
  }

  private startTicker(orderId: string): void {
    if (this.timers.has(orderId)) {
      return;
    }

    const timer = setInterval(() => {
      this.advance(orderId);
    }, 8000);

    this.timers.set(orderId, timer);
  }

  private stopTicker(orderId: string): void {
    const timer = this.timers.get(orderId);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.timers.delete(orderId);
  }

  private advance(orderId: string): void {
    const order = this.ordersSignal()[orderId];
    if (!order) {
      this.stopTicker(orderId);
      return;
    }

    if (order.status === 'delivered') {
      this.stopTicker(orderId);
      return;
    }

    const nextIndex = Math.min(order.progressIndex + 1, order.route.length - 1);
    const nextStatus = this.resolveStatus(nextIndex, order.route.length);
    const nextEta = Math.max(0, (order.route.length - 1 - nextIndex) * 4);
    const now = Date.now();
    const nextEvents =
      order.events[order.events.length - 1]?.status === nextStatus
        ? order.events
        : [...order.events, { status: nextStatus, label: this.statusLabel(nextStatus), time: now }];

    const updated: TrackingOrder = {
      ...order,
      progressIndex: nextIndex,
      current: order.route[nextIndex],
      status: nextStatus,
      etaMinutes: nextEta,
      updatedAt: now,
      events: nextEvents,
    };

    this.ordersSignal.update((current) => ({
      ...current,
      [orderId]: updated,
    }));
    this.persist();

    if (updated.status === 'delivered') {
      this.stopTicker(orderId);
    }
  }

  private resolveStatus(index: number, length: number): DeliveryStatus {
    if (index <= 1) {
      return 'picked_up';
    }
    if (index >= length - 1) {
      return 'delivered';
    }
    if (index >= Math.floor(length * 0.75)) {
      return 'nearby';
    }
    return 'on_the_way';
  }

  private resolveDestination(city: string): DeliveryPoint {
    const lookup: Record<string, DeliveryPoint> = {
      hyderabad: { lat: 17.385, lng: 78.4867 },
      bengaluru: { lat: 12.9716, lng: 77.5946 },
      bangalore: { lat: 12.9716, lng: 77.5946 },
      chennai: { lat: 13.0827, lng: 80.2707 },
      mumbai: { lat: 19.076, lng: 72.8777 },
      delhi: { lat: 28.6139, lng: 77.209 },
    };

    const key = city.trim().toLowerCase();
    const center = lookup[key] ?? lookup['hyderabad'];
    return {
      lat: center.lat + this.randomOffset(0.018),
      lng: center.lng + this.randomOffset(0.018),
    };
  }

  private resolveOrigin(city: string): DeliveryPoint {
    const destination = this.resolveDestination(city);
    return {
      lat: destination.lat + this.randomOffset(0.03),
      lng: destination.lng + this.randomOffset(0.03),
    };
  }

  private buildRoute(origin: DeliveryPoint, destination: DeliveryPoint, steps: number): DeliveryPoint[] {
    const route: DeliveryPoint[] = [];
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const curve = Math.sin(t * Math.PI) * 0.004;
      route.push({
        lat: this.round(origin.lat + (destination.lat - origin.lat) * t + curve),
        lng: this.round(origin.lng + (destination.lng - origin.lng) * t - curve / 2),
      });
    }
    return route;
  }

  private resumeActiveTracking(): void {
    const orders = Object.values(this.ordersSignal());
    for (const order of orders) {
      if (order.status !== 'delivered') {
        this.startTicker(order.orderId);
      }
    }
  }

  private pickAgent(): { name: string; phone: string } {
    const agents = [
      { name: 'Ravi Kumar', phone: '+91 90000 10021' },
      { name: 'Sneha Reddy', phone: '+91 90000 10022' },
      { name: 'Arjun Patel', phone: '+91 90000 10023' },
      { name: 'Aisha Khan', phone: '+91 90000 10024' },
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  private readFromStorage(): Record<string, TrackingOrder> {
    try {
      if (!this.canUseStorage()) {
        return {};
      }

      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as Record<string, TrackingOrder>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(this.ordersSignal()));
  }

  private canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  private randomOffset(maxDelta: number): number {
    return (Math.random() * 2 - 1) * maxDelta;
  }

  private round(value: number): number {
    return Math.round(value * 1000000) / 1000000;
  }
}

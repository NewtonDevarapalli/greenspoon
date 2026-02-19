import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

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

export interface TrackingLocationUpdate {
  lat: number;
  lng: number;
  status: DeliveryStatus;
  etaMinutes: number;
}

type OrderSnapshot = Record<string, TrackingOrder>;

interface TrackingApiAdapter {
  createOrderTracking(payload: NewTrackingOrder): Promise<TrackingOrder>;
  getOrder(orderId: string): Promise<TrackingOrder | null>;
  updateTrackingLocation(
    orderId: string,
    payload: TrackingLocationUpdate
  ): Promise<boolean>;
}

@Injectable({ providedIn: 'root' })
export class LocalTrackingService implements TrackingApiAdapter {
  private readonly storageKey = 'greenspoon-live-tracking-v1';
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly orders: OrderSnapshot = this.readFromStorage();

  constructor() {
    this.resumeActiveTracking();
  }

  async createOrderTracking(payload: NewTrackingOrder): Promise<TrackingOrder> {
    const existing = this.orders[payload.orderId];
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

    this.orders[order.orderId] = order;
    this.persist();
    this.startTicker(order.orderId);
    return order;
  }

  async getOrder(orderId: string): Promise<TrackingOrder | null> {
    return this.orders[orderId] ?? null;
  }

  async updateTrackingLocation(
    orderId: string,
    payload: TrackingLocationUpdate
  ): Promise<boolean> {
    const existing = this.orders[orderId];
    if (!existing) {
      return false;
    }

    const now = Date.now();
    const lastStatus = existing.events[existing.events.length - 1]?.status;
    const nextEvents =
      lastStatus === payload.status
        ? existing.events
        : [
            ...existing.events,
            {
              status: payload.status,
              label: this.statusLabel(payload.status),
              time: now,
            },
          ];

    const progressMap: Record<DeliveryStatus, number> = {
      assigned: 0,
      picked_up: 2,
      on_the_way: 7,
      nearby: 11,
      delivered: 13,
    };
    const progressIndex = Math.min(
      existing.route.length - 1,
      progressMap[payload.status] ?? existing.progressIndex
    );

    this.orders[orderId] = {
      ...existing,
      status: payload.status,
      etaMinutes: payload.etaMinutes,
      current: { lat: payload.lat, lng: payload.lng },
      progressIndex,
      updatedAt: now,
      events: nextEvents,
    };
    this.persist();

    if (payload.status === 'delivered') {
      this.stopTicker(orderId);
    } else {
      this.startTicker(orderId);
    }

    return true;
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
    const order = this.orders[orderId];
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
        : [
            ...order.events,
            { status: nextStatus, label: this.statusLabel(nextStatus), time: now },
          ];

    this.orders[orderId] = {
      ...order,
      progressIndex: nextIndex,
      current: order.route[nextIndex],
      status: nextStatus,
      etaMinutes: nextEta,
      updatedAt: now,
      events: nextEvents,
    };
    this.persist();

    if (this.orders[orderId].status === 'delivered') {
      this.stopTicker(orderId);
      return;
    }

    if (nextIndex >= order.route.length - 1 && nextStatus === 'nearby') {
      this.stopTicker(orderId);
    }
  }

  private resolveStatus(index: number, length: number): DeliveryStatus {
    if (index <= 1) {
      return 'picked_up';
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

  private buildRoute(
    origin: DeliveryPoint,
    destination: DeliveryPoint,
    steps: number
  ): DeliveryPoint[] {
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
    const orders = Object.values(this.orders);
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

  private readFromStorage(): OrderSnapshot {
    try {
      if (!this.canUseStorage()) {
        return {};
      }

      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as OrderSnapshot;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (!this.canUseStorage()) {
      return;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(this.orders));
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

@Injectable({ providedIn: 'root' })
export class HttpTrackingService implements TrackingApiAdapter {
  private readonly baseUrl = environment.api.baseUrl;

  constructor(private readonly http: HttpClient) {}

  async createOrderTracking(payload: NewTrackingOrder): Promise<TrackingOrder> {
    const existing = await this.getOrder(payload.orderId);
    if (existing) {
      return existing;
    }
    return this.toFallbackTracking(payload);
  }

  async getOrder(orderId: string): Promise<TrackingOrder | null> {
    try {
      const dto = await firstValueFrom(
        this.http.get<HttpTrackingDto>(`${this.baseUrl}/tracking/${orderId}`)
      );
      return this.mapHttpTracking(dto);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async updateTrackingLocation(
    orderId: string,
    payload: TrackingLocationUpdate
  ): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ ok: boolean }>(
          `${this.baseUrl}/tracking/${orderId}/location`,
          payload
        )
      );
      return Boolean(response.ok);
    } catch (error) {
      if (this.isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private mapHttpTracking(dto: HttpTrackingDto): TrackingOrder {
    const statusProgress: Record<DeliveryStatus, number> = {
      assigned: 1,
      picked_up: 3,
      on_the_way: 7,
      nearby: 10,
      delivered: 13,
    };
    const routeLength = 14;
    const progressIndex = Math.min(routeLength - 1, statusProgress[dto.status] ?? 0);
    const route = Array.from({ length: routeLength }, () => ({ ...dto.current }));

    return {
      orderId: dto.orderId,
      customerName: '',
      customerPhone: '',
      addressLine: '',
      city: '',
      notes: '',
      total: 0,
      paymentMode: '',
      status: dto.status,
      agentName: dto.agentName,
      agentPhone: dto.agentPhone,
      route,
      progressIndex,
      current: dto.current,
      etaMinutes: dto.etaMinutes,
      createdAt: dto.events[0]?.time ?? dto.updatedAt,
      updatedAt: dto.updatedAt,
      events: dto.events,
    };
  }

  private toFallbackTracking(payload: NewTrackingOrder): TrackingOrder {
    const now = Date.now();
    return {
      ...payload,
      status: 'assigned',
      agentName: 'Delivery agent',
      agentPhone: 'Updating...',
      route: [{ lat: 0, lng: 0 }],
      progressIndex: 0,
      current: { lat: 0, lng: 0 },
      etaMinutes: 0,
      createdAt: now,
      updatedAt: now,
      events: [{ status: 'assigned', label: 'Tracking will start shortly', time: now }],
    };
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 404;
  }
}

@Injectable({ providedIn: 'root' })
export class TrackingService {
  private readonly adapter: TrackingApiAdapter;
  private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly local: LocalTrackingService,
    private readonly remote: HttpTrackingService
  ) {
    this.adapter = environment.api.orderApiMode === 'http' ? this.remote : this.local;
  }

  createOrderTracking(payload: NewTrackingOrder): Promise<TrackingOrder> {
    return this.adapter.createOrderTracking(payload);
  }

  getOrder(orderId: string): Promise<TrackingOrder | null> {
    return this.adapter.getOrder(orderId);
  }

  updateTrackingLocation(
    orderId: string,
    payload: TrackingLocationUpdate
  ): Promise<boolean> {
    return this.adapter.updateTrackingLocation(orderId, payload);
  }

  watchOrder(
    orderId: string,
    onChange: (order: TrackingOrder | null) => void,
    intervalMs = 8000
  ): () => void {
    const existing = this.pollers.get(orderId);
    if (existing) {
      clearInterval(existing);
      this.pollers.delete(orderId);
    }

    void this.getOrder(orderId).then((order) => onChange(order));

    const timer = setInterval(() => {
      void this.getOrder(orderId).then((order) => onChange(order));
    }, intervalMs);

    this.pollers.set(orderId, timer);

    return () => {
      const active = this.pollers.get(orderId);
      if (!active) {
        return;
      }
      clearInterval(active);
      this.pollers.delete(orderId);
    };
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
}

interface HttpTrackingDto {
  orderId: string;
  status: DeliveryStatus;
  agentName: string;
  agentPhone: string;
  etaMinutes: number;
  current: DeliveryPoint;
  events: DeliveryEvent[];
  updatedAt: number;
}

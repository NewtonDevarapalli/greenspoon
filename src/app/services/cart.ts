import { Injectable } from '@angular/core';
import { signal } from '@angular/core';

export interface CartItem {
  id: string;
  name: string;
  type: string;
  image: string;
  price: number;
  calories: string;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly storageKey = 'greenspoon-cart-v1';
  private readonly itemsSignal = signal<CartItem[]>(this.readFromStorage());

  readonly items = this.itemsSignal.asReadonly();

  add(item: Omit<CartItem, 'quantity'>, quantity = 1): void {
    this.itemsSignal.update((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      if (existing) {
        return current.map((entry) =>
          entry.id === item.id
            ? { ...entry, quantity: entry.quantity + quantity }
            : entry
        );
      }

      return [...current, { ...item, quantity }];
    });
    this.persist();
  }

  increment(id: string): void {
    this.itemsSignal.update((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, quantity: entry.quantity + 1 } : entry
      )
    );
    this.persist();
  }

  decrement(id: string): void {
    this.itemsSignal.update((current) =>
      current
        .map((entry) =>
          entry.id === id ? { ...entry, quantity: entry.quantity - 1 } : entry
        )
        .filter((entry) => entry.quantity > 0)
    );
    this.persist();
  }

  remove(id: string): void {
    this.itemsSignal.update((current) =>
      current.filter((entry) => entry.id !== id)
    );
    this.persist();
  }

  clear(): void {
    this.itemsSignal.set([]);
    this.persist();
  }

  subtotal(): number {
    return this.itemsSignal().reduce(
      (sum, entry) => sum + entry.price * entry.quantity,
      0
    );
  }

  itemCount(): number {
    return this.itemsSignal().reduce((sum, entry) => sum + entry.quantity, 0);
  }

  private readFromStorage(): CartItem[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as CartItem[];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(
        (entry) =>
          typeof entry.id === 'string' &&
          typeof entry.name === 'string' &&
          typeof entry.type === 'string' &&
          typeof entry.image === 'string' &&
          typeof entry.price === 'number' &&
          typeof entry.calories === 'string' &&
          typeof entry.quantity === 'number'
      );
    } catch {
      return [];
    }
  }

  private persist(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.itemsSignal()));
  }
}

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CartService } from '../services/cart';
import { CartItem } from '../services/cart';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cart.html',
  styleUrl: './cart.scss',
})
export class Cart {
  constructor(private readonly cart: CartService) {}

  items(): CartItem[] {
    return this.cart.items();
  }

  subtotal(): number {
    return this.cart.subtotal();
  }

  deliveryFee(): number {
    return this.items().length > 0 ? 39 : 0;
  }

  tax(): number {
    return Math.round(this.subtotal() * 0.05);
  }

  grandTotal(): number {
    return this.subtotal() + this.deliveryFee() + this.tax();
  }

  increment(id: string): void {
    this.cart.increment(id);
  }

  decrement(id: string): void {
    this.cart.decrement(id);
  }

  remove(id: string): void {
    this.cart.remove(id);
  }

  clear(): void {
    this.cart.clear();
  }
}

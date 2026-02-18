import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { FoodService } from '../services/food';
import { CartService } from '../services/cart';


@Component({
selector: 'app-food-list',
standalone: true,
imports: [CommonModule, MatCardModule, MatButtonModule],
templateUrl: './food-list.html',
styleUrl: './food-list.scss'
})
export class FoodList {
foods: any[];
constructor(private foodService: FoodService, private cart: CartService) {
  this.foods = this.foodService.getFoods();
}
add(food:any){ this.cart.add(food); }
}
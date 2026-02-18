import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '../services/cart';

interface MenuItem {
  id: string;
  name: string;
  type: string;
  calories: string;
  price: number;
  image: string;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './menu.html',
  styleUrl: './menu.scss'
})
export class Menu {
  constructor(private readonly cart: CartService) {}

  readonly topTags = ['High Protein', 'Detox Friendly', 'No Refined Sugar', 'Fresh Daily'];

  readonly menuItems: MenuItem[] = [
    {
      id: 'power-sprouts-bowl',
      name: 'Power Sprouts Bowl',
      type: 'Sprouts',
      calories: '320 kcal',
      price: 219,
      image: '/hero.jpg'
    },
    {
      id: 'zesty-quinoa-salad',
      name: 'Zesty Quinoa Salad',
      type: 'Salads',
      calories: '280 kcal',
      price: 249,
      image: '/images/food2.png'
    },
    {
      id: 'cucumber-mint-cooler',
      name: 'Cucumber Mint Cooler',
      type: 'Better Water',
      calories: '30 kcal',
      price: 99,
      image: '/images/food1.png'
    },
    {
      id: 'color-crunch-salad',
      name: 'Color Crunch Salad',
      type: 'Salads',
      calories: '300 kcal',
      price: 229,
      image: '/images/food4.png'
    },
    {
      id: 'lemon-basil-hydrate',
      name: 'Lemon Basil Hydrate',
      type: 'Better Water',
      calories: '22 kcal',
      price: 89,
      image: '/images/food3.png'
    },
    {
      id: 'chef-daily-bowl',
      name: 'Chef Daily Bowl',
      type: 'Sprouts',
      calories: '360 kcal',
      price: 269,
      image: '/images/food4.png'
    }
  ];

  readonly combos = [
    {
      title: 'Office Lunch Combo',
      detail: '1 salad + 1 infused water',
      price: 'INR 299'
    },
    {
      title: 'Post Workout Combo',
      detail: '1 sprouts bowl + hydration bottle',
      price: 'INR 329'
    },
    {
      title: 'Weekly Smart Pack',
      detail: '5 meals + 5 waters',
      price: 'INR 1,699'
    }
  ];

  addToCart(item: MenuItem): void {
    this.cart.add({
      id: item.id,
      name: item.name,
      type: item.type,
      image: item.image,
      price: item.price,
      calories: item.calories
    });
  }
}

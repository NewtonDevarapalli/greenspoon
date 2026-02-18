import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrls: ['./home.scss']
})
export class Home {
  readonly featuredCategories = [
    {
      title: 'Sprouts Bowls',
      subtitle: 'Crunchy, protein-rich bowls with house dressings.',
      badge: 'Most Ordered',
      image: 'images/food4.png'
    },
    {
      title: 'Farm Fresh Salads',
      subtitle: 'Colorful daily salads prepped from morning produce.',
      badge: 'Chef Pick',
      image: 'images/food2.png'
    },
    {
      title: 'Better Water',
      subtitle: 'Lemon-mint infused hydration crafted every day.',
      badge: 'New',
      image: 'images/food1.png'
    }
  ];

  readonly planCards = [
    {
      title: 'Daily Lite',
      meals: '1 meal/day',
      price: 'INR 2,499',
      points: 'Ideal for office lunches'
    },
    {
      title: 'Balanced Plus',
      meals: '2 meals/day',
      price: 'INR 4,599',
      points: 'Best for fitness routines'
    },
    {
      title: 'Family Smart',
      meals: '4 meals/day',
      price: 'INR 8,699',
      points: 'Custom portions for home'
    }
  ];

  readonly testimonials = [
    {
      quote: 'Green Spoon fixed my weekday eating. Fresh, clean, and always on time.',
      name: 'Srikanth R.',
      role: 'Product Manager'
    },
    {
      quote: 'The Better Water and sprouts combo is now my daily ritual after workouts.',
      name: 'Harini M.',
      role: 'Pilates Coach'
    },
    {
      quote: 'Packaging is neat, food feels homemade, and subscriptions are easy to manage.',
      name: 'Ananya K.',
      role: 'Founder'
    }
  ];

  readonly serviceAreas = ['Hyderabad', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi'];
}

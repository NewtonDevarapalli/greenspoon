import { Component } from '@angular/core';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [],
  templateUrl: './about.html',
  styleUrl: './about.scss'
})
export class About {
  readonly principles = [
    {
      title: 'Fresh-First Sourcing',
      detail: 'Ingredients are procured daily from trusted local vendors.'
    },
    {
      title: 'Nutrition-Led Recipes',
      detail: 'Every bowl is portioned for balanced energy and protein.'
    },
    {
      title: 'Cloud Kitchen Precision',
      detail: 'Fast prep and clean packaging keep quality consistent.'
    }
  ];

  readonly milestones = [
    {
      year: '2024',
      detail: 'Green Spoon started as a micro kitchen with a sprouts-first menu.'
    },
    {
      year: '2025',
      detail: 'Expanded into salads, better water, and recurring meal subscriptions.'
    },
    {
      year: '2026',
      detail: 'Built a scalable cloud-kitchen model for city-wide operations.'
    }
  ];
}

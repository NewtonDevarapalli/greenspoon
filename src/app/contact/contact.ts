import { Component } from '@angular/core';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [],
  templateUrl: './contact.html',
  styleUrl: './contact.scss'
})
export class Contact {
  readonly channels = [
    {
      title: 'Customer Support',
      detail: '+91 90000 11122 | support@greenspoonfoods.com'
    },
    {
      title: 'Subscriptions Desk',
      detail: '+91 90000 33344 | plans@greenspoonfoods.com'
    },
    {
      title: 'Franchise Enquiries',
      detail: '+91 90000 55566 | franchise@greenspoonfoods.com'
    }
  ];

  readonly serviceCities = ['Hyderabad', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi'];
}

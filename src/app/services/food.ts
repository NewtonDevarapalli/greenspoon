import { Injectable } from '@angular/core';
import { Food } from '../models/food';


@Injectable({ providedIn: 'root' })
export class FoodService {
foods: Food[] = [
{ id:1, name:'Veg Exotic Salad', description:'Fresh veggies', price:249, image:'assets/veg.jpg' },
{ id:2, name:'Paneer Bowl', description:'Protein rich', price:299, image:'assets/paneer.jpg' }
];


getFoods() { return this.foods; }
}
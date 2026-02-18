import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Menu } from './menu/menu';
import { Cart } from './cart/cart';
import { Checkout } from './checkout/checkout';
import { About } from './about/about';
import { Contact } from './contact/contact';


export const routes: Routes = [
{ path: '', component: Home },
{ path: 'menu', component: Menu },
{ path: 'cart', component: Cart },
{ path: 'checkout', component: Checkout },
{ path: 'about', component: About },
{ path: 'contact', component: Contact }
];
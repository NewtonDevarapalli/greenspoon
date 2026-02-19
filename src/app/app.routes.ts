import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Menu } from './menu/menu';
import { Cart } from './cart/cart';
import { Checkout } from './checkout/checkout';
import { About } from './about/about';
import { Contact } from './contact/contact';
import { Tracking } from './tracking/tracking';
import { AdminOrders } from './admin-orders/admin-orders';
import { AdminDispatch } from './admin-dispatch/admin-dispatch';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'menu', component: Menu },
  { path: 'cart', component: Cart },
  { path: 'checkout', component: Checkout },
  { path: 'track/:orderId', component: Tracking },
  { path: 'about', component: About },
  { path: 'contact', component: Contact },
  { path: 'admin/orders', component: AdminOrders },
  { path: 'admin/dispatch', component: AdminDispatch },
];

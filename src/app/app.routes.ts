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
import { MyOrders } from './my-orders/my-orders';
import { Login } from './login/login';
import { authRoleGuard } from './guards/auth-role.guard';
import { AdminTenants } from './admin-tenants/admin-tenants';
import { AdminMasterData } from './admin-master-data/admin-master-data';
import { SubscriptionBlocked } from './subscription-blocked/subscription-blocked';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'menu', component: Menu },
  { path: 'cart', component: Cart },
  { path: 'checkout', component: Checkout },
  { path: 'my-orders', component: MyOrders },
  { path: 'login', component: Login },
  { path: 'subscription-blocked', component: SubscriptionBlocked },
  { path: 'track/:orderId', component: Tracking },
  { path: 'about', component: About },
  { path: 'contact', component: Contact },
  {
    path: 'admin/tenants',
    component: AdminTenants,
    canActivate: [authRoleGuard],
    data: { roles: ['platform_admin'] },
  },
  {
    path: 'admin/master-data',
    component: AdminMasterData,
    canActivate: [authRoleGuard],
    data: { roles: ['platform_admin'] },
  },
  {
    path: 'admin/orders',
    component: AdminOrders,
    canActivate: [authRoleGuard],
    data: { roles: ['platform_admin', 'restaurant_owner', 'manager'] },
  },
  {
    path: 'admin/dispatch',
    component: AdminDispatch,
    canActivate: [authRoleGuard],
    data: { roles: ['platform_admin', 'restaurant_owner', 'manager', 'dispatch'] },
  },
  { path: '**', redirectTo: '' },
];

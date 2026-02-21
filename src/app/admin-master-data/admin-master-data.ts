import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppRole } from '../models/auth';
import { MenuItemRecord, RestaurantRecord } from '../models/master-data';
import { TenantWithSubscription } from '../models/tenant';
import { MasterDataApiService } from '../services/master-data-api';
import { TenantApiService } from '../services/tenant-api';

@Component({
  selector: 'app-admin-master-data',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-master-data.html',
  styleUrl: './admin-master-data.scss',
})
export class AdminMasterData implements OnInit {
  readonly loading = signal(true);
  readonly statusMessage = signal('');
  readonly errorMessage = signal('');

  readonly roles = signal<{ role: AppRole; label: string }[]>([]);
  readonly tenants = signal<TenantWithSubscription[]>([]);
  readonly users = signal<
    {
      userId: string;
      email: string;
      name: string;
      role: AppRole;
      tenantId: string;
      isActive: boolean;
      createdAt: number;
    }[]
  >([]);
  readonly restaurants = signal<RestaurantRecord[]>([]);
  readonly menuItems = signal<MenuItemRecord[]>([]);

  userEmail = '';
  userPassword = '';
  userName = '';
  userRole: AppRole = 'manager';
  userTenantId = '';

  restaurantId = '';
  restaurantTenantId = '';
  restaurantName = '';
  restaurantCity = '';
  restaurantActive = true;

  menuItemId = '';
  menuTenantId = '';
  menuRestaurantId = '';
  menuName = '';
  menuCategory = 'Sprouts';
  menuPrice = 199;
  menuCalories = '300 kcal';
  menuImage = 'images/food4.png';
  menuDescription = '';
  menuIsActive = true;
  selectedMenuImageFile: File | null = null;

  busyUserCreate = signal(false);
  busyRestaurantCreate = signal(false);
  busyMenuCreate = signal(false);
  busyImageUpload = signal(false);
  busyActionId = signal('');

  constructor(
    private readonly masterDataApi: MasterDataApiService,
    private readonly tenantApi: TenantApiService
  ) {}

  ngOnInit(): void {
    void this.loadAll();
  }

  async refresh(): Promise<void> {
    await this.loadAll();
  }

  async createUser(): Promise<void> {
    if (!this.userEmail.trim() || !this.userPassword.trim() || !this.userName.trim() || !this.userTenantId.trim()) {
      this.errorMessage.set('User email, password, name and tenant are required.');
      return;
    }
    this.busyUserCreate.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const created = await this.masterDataApi.createUser({
        email: this.userEmail.trim().toLowerCase(),
        password: this.userPassword,
        name: this.userName.trim(),
        role: this.userRole,
        tenantId: this.userTenantId.trim(),
      });
      this.users.update((list) => [...list, created].sort((a, b) => a.email.localeCompare(b.email)));
      this.userEmail = '';
      this.userPassword = '';
      this.userName = '';
      this.statusMessage.set(`User ${created.email} created.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyUserCreate.set(false);
    }
  }

  async deactivateUser(userId: string): Promise<void> {
    this.busyActionId.set(`user:${userId}`);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const updated = await this.masterDataApi.deactivateUser(userId);
      this.users.update((list) => list.map((entry) => (entry.userId === userId ? updated : entry)));
      this.statusMessage.set(`User ${updated.email} deactivated.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyActionId.set('');
    }
  }

  async createRestaurant(): Promise<void> {
    if (!this.restaurantId.trim() || !this.restaurantTenantId.trim() || !this.restaurantName.trim() || !this.restaurantCity.trim()) {
      this.errorMessage.set('Restaurant ID, tenant, name and city are required.');
      return;
    }
    this.busyRestaurantCreate.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const created = await this.masterDataApi.createRestaurant({
        restaurantId: this.restaurantId.trim(),
        tenantId: this.restaurantTenantId.trim(),
        name: this.restaurantName.trim(),
        city: this.restaurantCity.trim(),
        isActive: this.restaurantActive,
      });
      this.restaurants.update((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      this.restaurantId = '';
      this.restaurantName = '';
      this.restaurantCity = '';
      this.statusMessage.set(`Restaurant ${created.name} created.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyRestaurantCreate.set(false);
    }
  }

  async toggleRestaurant(restaurant: RestaurantRecord): Promise<void> {
    this.busyActionId.set(`restaurant:${restaurant.restaurantId}`);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const updated = await this.masterDataApi.updateRestaurant(restaurant.restaurantId, {
        isActive: !restaurant.isActive,
      });
      this.restaurants.update((list) =>
        list.map((entry) => (entry.restaurantId === restaurant.restaurantId ? updated : entry))
      );
      this.statusMessage.set(`Restaurant ${updated.restaurantId} updated.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyActionId.set('');
    }
  }

  async createMenuItem(): Promise<void> {
    if (
      !this.menuItemId.trim() ||
      !this.menuTenantId.trim() ||
      !this.menuRestaurantId.trim() ||
      !this.menuName.trim() ||
      !this.menuCategory.trim() ||
      !Number.isFinite(this.menuPrice)
    ) {
      this.errorMessage.set('Menu item id, tenant, restaurant, name, category and price are required.');
      return;
    }

    this.busyMenuCreate.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const created = await this.masterDataApi.createMenuItem({
        menuItemId: this.menuItemId.trim(),
        tenantId: this.menuTenantId.trim(),
        restaurantId: this.menuRestaurantId.trim(),
        name: this.menuName.trim(),
        category: this.menuCategory.trim(),
        price: this.menuPrice,
        calories: this.menuCalories.trim(),
        image: this.menuImage.trim(),
        description: this.menuDescription.trim(),
        isActive: this.menuIsActive,
      });
      this.menuItems.update((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      this.menuItemId = '';
      this.menuName = '';
      this.menuDescription = '';
      this.statusMessage.set(`Menu item ${created.name} created.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyMenuCreate.set(false);
    }
  }

  async toggleMenuItem(item: MenuItemRecord): Promise<void> {
    this.busyActionId.set(`menu:${item.menuItemId}`);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const updated = await this.masterDataApi.updateMenuItem(item.menuItemId, {
        isActive: !item.isActive,
      });
      this.menuItems.update((list) => list.map((entry) => (entry.menuItemId === item.menuItemId ? updated : entry)));
      this.statusMessage.set(`Menu item ${updated.menuItemId} updated.`);
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyActionId.set('');
    }
  }

  onMenuTenantChange(): void {
    const restaurantForTenant = this.restaurantsForTenant(this.menuTenantId)[0];
    this.menuRestaurantId = restaurantForTenant?.restaurantId || '';
  }

  onMenuImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedMenuImageFile = input.files?.[0] ?? null;
  }

  async uploadSelectedMenuImage(): Promise<void> {
    if (!this.selectedMenuImageFile) {
      this.errorMessage.set('Select an image file first.');
      return;
    }
    this.busyImageUpload.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const uploaded = await this.masterDataApi.uploadMenuImage(this.selectedMenuImageFile);
      this.menuImage = uploaded.url;
      this.statusMessage.set('Image uploaded. It will be used for new menu item.');
      this.selectedMenuImageFile = null;
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.busyImageUpload.set(false);
    }
  }

  restaurantsForTenant(tenantId: string): RestaurantRecord[] {
    return this.restaurants()
      .filter((entry) => entry.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    this.statusMessage.set('');
    try {
      const [roles, tenants, users, restaurants, menuItems] = await Promise.all([
        this.masterDataApi.listRoles(),
        this.tenantApi.listTenants(),
        this.masterDataApi.listUsers(),
        this.masterDataApi.listRestaurants(),
        this.masterDataApi.listMenuItems(),
      ]);
      this.roles.set(roles);
      this.tenants.set(tenants);
      this.users.set(users);
      this.restaurants.set(restaurants);
      this.menuItems.set(menuItems);

      const defaultTenantId = tenants[0]?.tenantId || '';
      if (!this.userTenantId) {
        this.userTenantId = defaultTenantId;
      }
      if (!this.restaurantTenantId) {
        this.restaurantTenantId = defaultTenantId;
      }
      if (!this.menuTenantId) {
        this.menuTenantId = defaultTenantId;
      }
      if (!this.menuRestaurantId) {
        this.menuRestaurantId = restaurants.find((entry) => entry.tenantId === this.menuTenantId)?.restaurantId || '';
      }
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error?.message === 'string') {
        return error.error.message;
      }
      return `Request failed with status ${error.status}.`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unexpected error. Please try again.';
  }
}

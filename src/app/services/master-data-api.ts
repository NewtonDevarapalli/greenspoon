import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AdminRoleOption,
  AdminUserRecord,
  CreateAdminUserPayload,
  CreateMenuItemPayload,
  CreateRestaurantPayload,
  MenuItemRecord,
  RestaurantRecord,
  UploadAssetResponse,
  UpdateAdminUserPayload,
  UpdateMenuItemPayload,
  UpdateRestaurantPayload,
} from '../models/master-data';

@Injectable({ providedIn: 'root' })
export class MasterDataApiService {
  private readonly baseUrl = environment.api.baseUrl;

  constructor(private readonly http: HttpClient) {}

  listRoles(): Promise<AdminRoleOption[]> {
    return firstValueFrom(this.http.get<AdminRoleOption[]>(`${this.baseUrl}/admin/roles`));
  }

  listUsers(): Promise<AdminUserRecord[]> {
    return firstValueFrom(this.http.get<AdminUserRecord[]>(`${this.baseUrl}/admin/users`));
  }

  createUser(payload: CreateAdminUserPayload): Promise<AdminUserRecord> {
    return firstValueFrom(this.http.post<AdminUserRecord>(`${this.baseUrl}/admin/users`, payload));
  }

  updateUser(userId: string, payload: UpdateAdminUserPayload): Promise<AdminUserRecord> {
    return firstValueFrom(
      this.http.patch<AdminUserRecord>(`${this.baseUrl}/admin/users/${encodeURIComponent(userId)}`, payload)
    );
  }

  deactivateUser(userId: string): Promise<AdminUserRecord> {
    return firstValueFrom(
      this.http.delete<AdminUserRecord>(`${this.baseUrl}/admin/users/${encodeURIComponent(userId)}`)
    );
  }

  listRestaurants(): Promise<RestaurantRecord[]> {
    return firstValueFrom(this.http.get<RestaurantRecord[]>(`${this.baseUrl}/admin/restaurants`));
  }

  createRestaurant(payload: CreateRestaurantPayload): Promise<RestaurantRecord> {
    return firstValueFrom(
      this.http.post<RestaurantRecord>(`${this.baseUrl}/admin/restaurants`, payload)
    );
  }

  updateRestaurant(restaurantId: string, payload: UpdateRestaurantPayload): Promise<RestaurantRecord> {
    return firstValueFrom(
      this.http.patch<RestaurantRecord>(
        `${this.baseUrl}/admin/restaurants/${encodeURIComponent(restaurantId)}`,
        payload
      )
    );
  }

  listMenuItems(): Promise<MenuItemRecord[]> {
    return firstValueFrom(this.http.get<MenuItemRecord[]>(`${this.baseUrl}/admin/menu-items`));
  }

  listPublicMenuItems(): Promise<MenuItemRecord[]> {
    return firstValueFrom(this.http.get<MenuItemRecord[]>(`${this.baseUrl}/menu-items`));
  }

  createMenuItem(payload: CreateMenuItemPayload): Promise<MenuItemRecord> {
    return firstValueFrom(this.http.post<MenuItemRecord>(`${this.baseUrl}/admin/menu-items`, payload));
  }

  updateMenuItem(menuItemId: string, payload: UpdateMenuItemPayload): Promise<MenuItemRecord> {
    return firstValueFrom(
      this.http.patch<MenuItemRecord>(
        `${this.baseUrl}/admin/menu-items/${encodeURIComponent(menuItemId)}`,
        payload
      )
    );
  }

  uploadMenuImage(file: File): Promise<UploadAssetResponse> {
    const body = new FormData();
    body.append('image', file);
    return firstValueFrom(
      this.http.post<UploadAssetResponse>(`${this.baseUrl}/admin/uploads/menu-image`, body)
    );
  }
}

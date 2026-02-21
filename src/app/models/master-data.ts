import { AppRole } from './auth';

export interface AdminRoleOption {
  role: AppRole;
  label: string;
}

export interface AdminUserRecord {
  userId: string;
  email: string;
  name: string;
  role: AppRole;
  tenantId: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAdminUserPayload {
  email: string;
  password: string;
  name: string;
  role: AppRole;
  tenantId: string;
  isActive?: boolean;
}

export interface UpdateAdminUserPayload {
  email?: string;
  password?: string;
  name?: string;
  role?: AppRole;
  tenantId?: string;
  isActive?: boolean;
}

export interface RestaurantRecord {
  restaurantId: string;
  tenantId: string;
  name: string;
  city: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRestaurantPayload {
  restaurantId: string;
  tenantId: string;
  name: string;
  city: string;
  isActive?: boolean;
}

export interface UpdateRestaurantPayload {
  tenantId?: string;
  name?: string;
  city?: string;
  isActive?: boolean;
}

export interface MenuItemRecord {
  menuItemId: string;
  tenantId: string;
  restaurantId: string;
  name: string;
  category: string;
  description: string;
  image: string;
  price: number;
  calories: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMenuItemPayload {
  menuItemId: string;
  tenantId: string;
  restaurantId: string;
  name: string;
  category: string;
  description?: string;
  image?: string;
  price: number;
  calories?: string;
  isActive?: boolean;
}

export interface UpdateMenuItemPayload {
  tenantId?: string;
  restaurantId?: string;
  name?: string;
  category?: string;
  description?: string;
  image?: string;
  price?: number;
  calories?: string;
  isActive?: boolean;
}

export interface UploadAssetResponse {
  filename: string;
  contentType: string;
  size: number;
  path: string;
  url: string;
}

export type AppRole =
  | 'platform_admin'
  | 'restaurant_owner'
  | 'manager'
  | 'dispatch'
  | 'kitchen'
  | 'rider'
  | 'customer';

export interface AuthSession {
  userId: string;
  email: string;
  name: string;
  role: AppRole;
  tenantId: string;
  loginAt: number;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: string;
  authMode?: 'local' | 'http';
}

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppRole } from '../models/auth';
import { AuthService } from '../services/auth';

export const authRoleGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  const allowedRoles = (route.data?.['roles'] ?? []) as AppRole[];
  if (allowedRoles.length > 0 && !auth.hasAnyRole(allowedRoles)) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url, reason: 'forbidden' },
    });
  }

  return true;
};

import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth';
import { SubscriptionStateService } from '../services/subscription-state';

const AUTH_RETRY_CONTEXT = new HttpContextToken<boolean>(() => false);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const subscriptionState = inject(SubscriptionStateService);

  if (!auth.shouldAttachToken(req.url)) {
    return next(req);
  }

  const token = auth.accessToken();
  const requestWithToken = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : req;

  return next(requestWithToken).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 402) {
        const details = (error.error?.details ?? {}) as {
          tenantId?: string;
          subscriptionStatus?: string;
          currentPeriodEnd?: number | null;
        };
        subscriptionState.setBlocked({
          tenantId: details.tenantId,
          subscriptionStatus: details.subscriptionStatus,
          currentPeriodEnd: details.currentPeriodEnd ?? null,
          message:
            typeof error.error?.message === 'string'
              ? error.error.message
              : 'Subscription is inactive for this tenant.',
        });
        void router.navigate(['/subscription-blocked']);
        return throwError(() => error);
      }

      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        req.context.get(AUTH_RETRY_CONTEXT)
      ) {
        return throwError(() => error);
      }

      return from(auth.refreshAccessToken()).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            from(auth.logout()).subscribe({
              complete: () => {
                void router.navigate(['/login'], {
                  queryParams: {
                    reason: 'session_expired',
                    returnUrl: router.url || '/',
                  },
                });
              },
            });
            return throwError(() => error);
          }

          const refreshedToken = auth.accessToken();
          if (!refreshedToken) {
            return throwError(() => error);
          }

          const retryRequest = req.clone({
            setHeaders: {
              Authorization: `Bearer ${refreshedToken}`,
            },
            context: req.context.set(AUTH_RETRY_CONTEXT, true),
          });

          return next(retryRequest);
        }),
        catchError((refreshError) => {
          from(auth.logout()).subscribe({
            complete: () => {
              void router.navigate(['/login'], {
                queryParams: {
                  reason: 'session_expired',
                  returnUrl: router.url || '/',
                },
              });
            },
          });
          return throwError(() => refreshError);
        })
      );
    })
  );
};

import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

export const AUTH_LOGINS_TOTAL = 'auth_logins_total';
export const AUTH_REGISTRATIONS_TOTAL = 'auth_registrations_total';
export const AUTH_JWT_REFRESHES_TOTAL = 'auth_jwt_refreshes_total';
export const AUTH_PASSWORD_RESETS_TOTAL = 'auth_password_resets_total';
export const AUTH_LOGOUTS_TOTAL = 'auth_logouts_total';
export const AUTH_EMAIL_VERIFICATIONS_TOTAL = 'auth_email_verifications_total';

export const authMetricsProviders = [
  makeCounterProvider({
    name: AUTH_LOGINS_TOTAL,
    help: 'Total number of login attempts',
    labelNames: ['status', 'method'],
  }),
  makeCounterProvider({
    name: AUTH_REGISTRATIONS_TOTAL,
    help: 'Total number of user registrations',
    labelNames: ['role'],
  }),
  makeCounterProvider({
    name: AUTH_JWT_REFRESHES_TOTAL,
    help: 'Total number of JWT token refresh operations',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: AUTH_PASSWORD_RESETS_TOTAL,
    help: 'Total number of password reset attempts',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: AUTH_LOGOUTS_TOTAL,
    help: 'Total number of user logout events',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: AUTH_EMAIL_VERIFICATIONS_TOTAL,
    help: 'Total number of email verification attempts',
    labelNames: ['status'],
  }),
];

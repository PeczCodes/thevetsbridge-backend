import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: process.env.PORT,
  env: process.env.NODE_ENV,
  logLevel: process.env.LOG_LEVEL || 'info',
  name: process.env.APP_NAME || 'vetsbridge',
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()) 
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'https://thevetsbridge-frontend.vercel.app',
        'https://www.vetsbridge.org',
        'https://vetsbridge.org'
      ],
  passwordResetExpiryMinutes: parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '30', 10),
  passwordResetBaseUrl: process.env.PASSWORD_RESET_BASE_URL || 'https://www.vetsbridge.org/reset-password',
  bypassOutbox: process.env.BYPASS_OUTBOX !== 'false',
}))




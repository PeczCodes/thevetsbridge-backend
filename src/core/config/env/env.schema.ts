import { z } from 'zod';

export const envSchema = z.object({
  // ==============================
  // Application
  // ==============================
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3005),
  APP_NAME: z.string(),

  // ==============================
  // Database
  // ==============================
  DATABASE_URL: z.string().url(),

  // ==============================
  // Redis
  // ==============================
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().or(z.literal('')),
  REDIS_DB: z.coerce.number().default(0),

  // ==============================
  // JWT Authentication
  // ==============================
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string(), // e.g. 15m
  JWT_REFRESH_EXPIRES_IN: z.string(), // e.g. 7d

  // ==============================
  // Google OAuth
  // ==============================
  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal('')),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  GOOGLE_CALLBACK_URL: z.string().url(),

  // ==============================
  // Frontend
  // ==============================
  FRONTEND_URL: z.string().url(),

  // ==============================
  // Paystack
  // ==============================
  PAYSTACK_SECRET_KEY: z.string(),
  PAYSTACK_PUBLIC_KEY: z.string(),
  PAYSTACK_WEBHOOK_SECRET: z.string(),

  // ==============================
  // SMTP Email
  // ==============================
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number(),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  SMTP_FROM: z.string(),

  // ==============================
  // Email Service (Resend)
  // ==============================
  RESEND_API_KEY: z.string().optional().or(z.literal('')),

  // ==============================
  // Rate Limiting
  // ==============================
  THROTTLE_TTL: z.coerce.number().default(60),
  THROTTLE_LIMIT: z.coerce.number().default(100),

  // ==============================
  // Cloudinary
  // ==============================
  CLOUDINARY_URL: z.string().url(),

  // ==============================
  // LiveKit Telemedicine
  // ==============================
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret'),
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
});

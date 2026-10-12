import { z } from 'zod';

export const envSchema = z.object({
  // ==============================
  // Application
  // ==============================
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number(),
  APP_NAME: z.string(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  BYPASS_OUTBOX: z.string().optional().default('true'),
  SWAGGER_ENABLED: z.string().optional().default('true'),

  // ==============================
  // Prometheus & Grafana Cloud Monitoring
  // ==============================
  METRICS_ENABLED: z.string().optional().default('true'),
  METRICS_AUTH_ENABLED: z.string().optional().default('false'),
  METRICS_API_KEY: z.string().optional(),
  GRAFANA_CLOUD_PROMETHEUS_URL: z.string().optional(),
  GRAFANA_CLOUD_PROMETHEUS_USER: z.string().optional(),
  GRAFANA_CLOUD_API_KEY: z.string().optional(),
  
  // ==============================
  // Redis
  // ==============================
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number(),
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

  // ==============================
  // Circuit Breaker (Opossum)
  // ==============================
  CIRCUIT_BREAKER_TIMEOUT: z.coerce.number().optional().default(30000),
  CIRCUIT_BREAKER_RESET_TIMEOUT: z.coerce.number().optional().default(30000),
  CIRCUIT_BREAKER_ERROR_THRESHOLD: z.coerce.number().optional().default(50),
  CIRCUIT_BREAKER_ROLLING_BUCKETS: z.coerce.number().optional().default(10),
  CIRCUIT_BREAKER_ROLLING_TIMEOUT: z.coerce.number().optional().default(10000),

  // ==============================
  // Telemedicine Lifecycle
  // ==============================
  TELEMEDICINE_NO_SHOW_GRACE_MINUTES: z.coerce.number().optional().default(15),
  TELEMEDICINE_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().optional().default(15),
  TELEMEDICINE_HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().optional().default(30),
  TELEMEDICINE_RECONNECT_TIMEOUT_SECONDS: z.coerce.number().optional().default(300),
  TELEMEDICINE_DISPUTE_WINDOW_HOURS: z.coerce.number().optional().default(24),

  // ==============================
  // Password Reset & Encryption
  // ==============================
  PASSWORD_RESET_EXPIRY_MINUTES: z.coerce.number().optional().default(30),
  PASSWORD_RESET_BASE_URL: z.string().url().optional().default('https://app.vetsbridge.com/reset-password'),
  ENCRYPTION_SECRET: z.string().optional().or(z.literal('')),
});

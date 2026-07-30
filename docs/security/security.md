# Security Model & Compliance

## Overview

VetsBridge incorporates end-to-end security controls across network transport, data persistence, token management, rate limiting, and authentication.

---

## 🛡️ Security Controls Matrix

### 1. Transport Security (TLS/HTTPS & WebSockets)
* **HTTPS Enforcement**: All production REST and WebSocket connections enforce TLS encryption.
* **CORS Protection**: CORS origins are strictly parsed and validated against `CORS_ORIGINS` and `FRONTEND_URL` ([telemedicine.gateway.ts:L16-L35](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/modules/telemedicine/gateways/telemedicine.gateway.ts#L16-L35)).

### 2. Cookie & Token Security
* **HTTP-Only Cookies**: Access and Refresh tokens are delivered via `httpOnly: true`, `secure: true`, and `sameSite: 'strict'` cookies ([auth.controller.ts:L39-L63](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/modules/identity/auth/auth.controller.ts#L39-L63)), preventing script extraction via XSS.
* **Refresh Token Hashing**: Refresh tokens stored in the PostgreSQL database are hashed using salted cryptographic hashing ([token.service.ts:L55](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/modules/identity/auth/services/token.service.ts#L55)).
* **Single-Use Rotation & Reuse Invalidation**: Presenting a previously rotated refresh token automatically invalidates the entire session tree ([token.service.ts:L113-L118](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/modules/identity/auth/services/token.service.ts#L113-L118)).

### 3. Rate Limiting & Throttling
* **NestJS Throttler**: Protects sensitive endpoints against brute-force attacks:
  - Login endpoint: Max 5 requests/minute (`@Throttle({ default: { limit: 5, ttl: 60000 } })`)
  - Registration endpoint: Max 3 requests/minute (`@Throttle({ default: { limit: 3, ttl: 60000 } })`)
  - Password Reset endpoint: Max 10 requests/hour

### 4. Input Validation & Sanitization
* **Global ValidationPipe**: Enforces strict DTO validation with `whitelist: true` and `forbidNonWhitelisted: true` ([main.ts:L31-L37](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/main.ts#L31-L37)).

### 5. Webhook Signature Verification
* **Paystack Webhook HMAC-SHA512**: incoming payment webhooks are validated against `PAYSTACK_SECRET_KEY` using timing-safe HMAC signature verification ([payment.service.ts](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/modules/payments/services/payment.service.ts)) before processing.

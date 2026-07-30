# Deployment & Operations Guide

## Overview

This guide details the deployment steps, environment configuration, database migration procedures, and startup commands required for production execution.

---

## 🛠️ Required Environment Variables

Ensure the following variables are configured in production:

```env
# Application
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://vetsbridge.org
CORS_ORIGINS=https://vetsbridge.org,https://app.vetsbridge.org

# Database & Cache
DATABASE_URL=postgresql://user:password@postgres-host:5432/vetsbridge?schema=public
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_PASSWORD=secret

# Security & JWT
JWT_ACCESS_SECRET=your_super_secret_access_key_min_32_chars
JWT_REFRESH_SECRET=your_super_secret_refresh_key_min_32_chars

# External Integrations
PAYSTACK_SECRET_KEY=sk_live_xxxx
PAYSTACK_PUBLIC_KEY=pk_live_xxxx
RESEND_API_KEY=re_xxxx
RESEND_FROM_EMAIL=VetsBridge <notifications@vetsbridge.org>
CLOUDINARY_CLOUD_NAME=vetsbridge
CLOUDINARY_API_KEY=xxxx
CLOUDINARY_API_SECRET=xxxx
LIVEKIT_API_KEY=xxxx
LIVEKIT_API_SECRET=xxxx
LIVEKIT_URL=wss://livekit.vetsbridge.org
```

---

## 🚀 Build & Production Startup Commands

### 1. Backend Build & Database Migration
```bash
cd vetsbridge-backend

# Install dependencies
npm ci

# Run Prisma schema migrations
npx prisma migrate deploy

# Build production nestjs bundle
npm run build

# Start production server
npm run start:prod
```

### 2. Frontend Build
```bash
cd vetsbridge-frontend

# Install dependencies
npm ci

# Build Next.js application
npm run build

# Start production server
npm run start
```

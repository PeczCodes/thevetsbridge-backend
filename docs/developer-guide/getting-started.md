# Developer Getting Started Guide

## Prerequisites

Ensure you have the following installed locally:
* **Node.js**: `v18.x` or `v20.x`
* **Package Manager**: `npm` or `bun`
* **PostgreSQL**: `v14` or higher
* **Redis**: `v6` or higher

---

## 🚀 Local Development Setup

### 1. Repository Setup
```bash
# Clone the repository
git clone https://github.com/vetsbridge/vetsbridge.git
cd vetsbridge
```

### 2. Backend Setup (`vetsbridge-backend`)
```bash
cd vetsbridge-backend

# Copy environment template
cp .env.example .env

# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Seed initial database records
npx prisma db seed

# Start development server with hot-reload
npm run start:dev
```
The backend API will be available at `http://localhost:3001` (Swagger docs at `http://localhost:3001/api/docs`).

### 3. Frontend Setup (`vetsbridge-frontend`)
```bash
cd vetsbridge-frontend

# Install dependencies
npm install

# Start Next.js development server
npm run dev
```
The frontend UI will be available at `http://localhost:3000`.

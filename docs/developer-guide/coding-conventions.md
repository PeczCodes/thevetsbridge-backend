# Coding Conventions & Architectural Standards

## 📏 Core Conventions

### 1. Font-Weight Guideline (Frontend UI)
* **Rule**: Avoid using bold font weight utilities (`font-bold`, `font-semibold`, `font-medium`).
* **Hierarchy Enforcement**: Establish hierarchy using font size, tracking, line height, and slate color contrast (`text-slate-900`, `text-slate-600`, `text-slate-400`).

### 2. Error Handling & Validation
* **DTO Validation**: All request bodies must be validated using `class-validator` decorators (`@IsString()`, `@IsEmail()`, `@IsOptional()`).
* **HTTP Exceptions**: Throw built-in NestJS exceptions (`BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`).
* **Never swallow exceptions**: Log full error tracebacks and preserve original error context.

### 3. Database & Concurrency Safety
* **Prisma Transactions**: Group multi-table state changes in `prisma.$transaction`.
* **Idempotency & Locks**: Use `SELECT ... FOR UPDATE` SQL locks when modifying financial balances (`UserBalance`) or processing payouts.
* **Soft Deletes**: Respect `deletedAt` timestamps when querying models supporting soft delete (`Animal`, `Address`).

### 4. Background Processing & Events
* **Outbox Pattern**: Never dispatch external API requests (Paystack, Resend) directly inside synchronous database transactions. Write an `OutboxEvent` and handle it asynchronously in BullMQ.

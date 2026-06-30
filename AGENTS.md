# AGENTS.md — TheVetsBridge Engineering Contract

## Purpose

This document defines mandatory engineering constraints for all AI-generated and human-written code in TheVetsBridge.

It ensures the system remains:

- production-grade
- scalable
- safe for medical workflows
- event-driven and consistent
- microservice-ready in future

---

# 1. System Architecture

TheVetsBridge is a:

> Modular Monolith (NestJS + Prisma + PostgreSQL + Redis)

Microservices are a FUTURE evolution, not current architecture.

---

# 2. Identity & Capability Model

**Identity Model Rule:**
The system uses profile-based access control (PBAC), not role-based business permissions.

**Identity = User**
**Capability = Profiles + Domain Context**
**Not Role Enums**

**Forbidden Patterns:**
- Using `UserRole` or similar enums for CUSTOMER, VET, or VENDOR.
- Checking `roles.includes("customer")` or similar role arrays for business permissions.
- Modeling "Customer" as a separate profile, role, or explicit status.

**Required Patterns:**
- Use `user.vetProfile` to determine Vet capabilities (e.g., verifying status).
- Use `user.vendorProfile` to determine Vendor capabilities.
- Customer capability is implicit. Every authenticated user is automatically a customer and can book consultations, own animals, and place orders.

---

# 2. Module Boundaries

Each module must be isolated:

Allowed:
- internal module services
- internal repositories
- domain events

Forbidden:
- direct cross-module database access
- cross-module business logic calls

---

# 3. Data Consistency Rules

## Transactions
All multi-write operations must use DB transactions.

## Concurrency Control
Use:
- optimistic concurrency control (version fields or timestamps)
- Redis locks for race-sensitive operations

---

# 4. Cache Rules

Cache must follow:
- cache-aside pattern
- TTL strategy with jitter
- stampede protection (single-flight or locking)

Cache is NEVER source of truth.

---

# 5. Event System Rules

## Outbox Pattern (MANDATORY)

For critical events:
1. write domain data
2. write outbox event in same transaction
3. publish asynchronously
4. mark as published

---

## Event Design

Events must:
- represent facts (past tense)
- be immutable
- be replayable

Example:
- appointment.created
- prescription.issued

---

## Event Consumers

Consumers must:
- be idempotent
- handle retries safely
- tolerate duplicate delivery

---

# 6. Idempotency Rules

Must be enforced for:
- payments
- orders
- appointments
- prescriptions
- job processing

Use:
- idempotency keys OR
- DB constraints OR
- deduplication tables

---

# 7. Queue Rules (Redis / BullMQ)

All jobs must:
- support retries
- have backoff strategy
- handle failure recovery
- be safe for duplicate execution

---

# 8. Testing Requirements

Every feature must include:

## Unit Tests
- domain logic validation

## Integration Tests
- DB + service interaction

## End-to-End Tests
- full request lifecycle validation

Critical flows are mandatory E2E:
- appointments
- prescriptions
- orders

---

# 9. Security Rules

- DTO validation required everywhere
- no raw request trust
- RBAC enforced
- ownership validation mandatory
- sensitive data must never be logged

---

# 10. Performance Rules

- paginate all list endpoints
- avoid N+1 queries
- index foreign keys
- optimize hot paths

---

# 11. Observability Rules

All critical flows must include:
- structured logging
- request correlation IDs
- audit logs for medical actions

---

# 12. AI CODE GENERATION RULES

All AI-generated code must:

- follow modular boundaries
- include error handling
- include validation
- be production-safe
- consider concurrency issues
- include tests where applicable

AI must prioritize:
1. correctness
2. safety
3. clarity
4. performance

---

# 13. FINAL PRINCIPLE

This system is not a prototype.

It is a production-grade veterinary platform handling:

- medical data
- commerce transactions
- real-world logistics

All code must reflect that reality.
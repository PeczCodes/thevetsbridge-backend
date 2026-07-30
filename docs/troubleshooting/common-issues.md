# Common Operational Issues & Troubleshooting

This document outlines common operational failure modes, root cause diagnostics, and remediation procedures.

---

## 🛠️ Issue Matrix

### 1. Redis Server Connection Failure
* **Symptom**: Logs display `[RedisService] Redis connection error: ECONNREFUSED`.
* **Root Cause**: Redis service is down or network firewall is blocking port `6379`.
* **Impact**: Background jobs freeze, rate limiting defaults to local memory, cache operations fall back to direct DB queries.
* **Remediation**:
  1. Restart Redis service: `sudo systemctl restart redis` or `docker restart vetsbridge-redis`.
  2. Verify ping: `redis-cli ping` (expected: `PONG`).

---

### 2. Database Locks & Transaction Timeouts
* **Symptom**: Logs show `P2028: Transaction API error: Transaction already ended` or query timeouts during payout processing.
* **Root Cause**: `SELECT ... FOR UPDATE` row lock held for longer than Prisma's default transaction timeout (5000ms).
* **Remediation**:
  1. Ensure long-running external API calls (e.g. Paystack HTTP request) are executed **outside** the database transaction lock ([payout.worker.ts:L121-L127](file:///Users/pecz/Desktop/Professional%20Projects/vetsbridge/vetsbridge-backend/src/modules/payments/workers/payout.worker.ts#L121-L127)).

---

### 3. Invalid Refresh Token / 401 Unauthorized Loop
* **Symptom**: User gets logged out repeatedly or receiving `401 Session is invalid or expired`.
* **Root Cause**: Two concurrent requests attempted to refresh the same token simultaneously, triggering reuse protection logic and revoking the session.
* **Remediation**:
  1. Ensure frontend HTTP client queue (`lib/axios-instance.ts`) locks during active token refresh requests so only one refresh call is in-flight at any time.

---

### 4. Resend API Circuit Breaker Open
* **Symptom**: Emails fail instantly with `ExternalServiceException: Circuit breaker [resend] is OPEN`.
* **Root Cause**: 5 consecutive API connection failures or timeouts occurred when reaching Resend servers.
* **Remediation**:
  1. Verify `RESEND_API_KEY` validity.
  2. The circuit breaker will automatically enter `HALF_OPEN` status after 30 seconds and test recovery.

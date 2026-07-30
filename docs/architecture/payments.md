# Payment & Ledger System

## Purpose

The payment and ledger system processes monetary transactions, appointment escrow holds, vendor product checkouts, and withdrawal payouts. It enforces double-entry accounting integrity, idempotency, and secure webhook verification.

---

## Participating Modules & Files

* **Module**: `src/modules/payments/payments.module.ts`
* **Services**:
  - `src/modules/payments/services/payment.service.ts`
  - `src/modules/payments/services/ledger.service.ts`
* **Providers**:
  - `src/modules/payments/providers/paystack.provider.ts`
* **Workers**:
  - `src/modules/payments/workers/payment-verification.worker.ts`
  - `src/modules/payments/workers/payout.worker.ts`
* **Prisma Models**: `Payment`, `LedgerEntry`, `UserBalance`, `FinancialTransaction`, `WebhookEventLog`

---

## Double-Entry Ledger Architecture

All financial movements are recorded as paired DEBIT and CREDIT entries in the `LedgerEntry` table:

```
[ Customer Wallet / Card ] ──(DEBIT)──▶ [ Platform Escrow Account ]
                                                  │
                                          (Consultation Done)
                                                  │
                                                  ▼
[ Platform Escrow Account ] ──(DEBIT)──▶ [ Vet Balance Account ] ──(CREDIT)
```

---

## Webhook Processing & Payment Verification Flow

```mermaid
sequenceDiagram
    autonumber
    actor Paystack as Paystack Gateway
    participant Ctrl as PaymentsController
    participant DB as PostgreSQL (Prisma)
    participant Queue as BullMQ (payment-verification-queue)
    participant Worker as PaymentVerificationWorker
    participant Ledger as LedgerService

    Paystack->>Ctrl: POST /v1/payments/webhook (Signature Header)
    Ctrl->>Ctrl: Validate HMAC-SHA512 Webhook Signature
    alt Invalid Signature
        Ctrl-->>Paystack: 401 Unauthorized
    else Valid Signature
        Ctrl->>DB: WebhookEventLog.create({ eventId, payload, status: RECEIVED })
        Ctrl->>Queue: Enqueue payment verification job
        Ctrl-->>Paystack: 200 OK (Immediate Acknowledgment)
    end

    Queue->>Worker: Process payment verification job
    Worker->>DB: Check WebhookEventLog idempotency
    Worker->>Ledger: Record payment ledger entries
    Worker->>DB: Update Payment, Appointment, or Order status to COMPLETED
    Worker-->>Queue: Verification Complete
```

---

## Payout Withdrawal Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User as Vet / Vendor
    participant Ctrl as PaymentsController
    participant Service as PaymentService
    participant Queue as BullMQ (payout-queue)
    participant Worker as PayoutWorker
    participant Paystack as Paystack API
    participant DB as PostgreSQL (Prisma)

    User->>Ctrl: POST /v1/payments/withdraw { amount, payoutAccountId }
    Ctrl->>Service: Initiate withdrawal request
    Service->>DB: $transaction([ Reserve balance, Create FinancialTransaction(status: PENDING) ])
    Service->>Queue: Enqueue payout job
    Service-->>User: 202 Accepted (Transaction Processing)

    Queue->>Worker: Process payout job
    Worker->>DB: SELECT * FROM FinancialTransaction WHERE id = txId FOR UPDATE
    Worker->>Worker: Check idempotency (ensure status is PENDING)
    Worker->>DB: Update status to PROCESSING
    Worker->>Paystack: PaystackProvider.initiateTransfer(amount, recipientCode, reference)
    alt Transfer Success
        Paystack-->>Worker: { status: 'success', transferCode }
        Worker->>DB: Update FinancialTransaction to COMPLETED
        Worker->>DB: Record Ledger debit entries & release reserved balance
    else Transfer Pending
        Paystack-->>Worker: { status: 'pending', transferCode }
        Worker->>DB: Remain in PROCESSING, wait for Paystack Webhook
    else Transfer Failed
        Paystack-->>Worker: { status: 'failed' }
        Worker->>DB: Update status to FAILED & restore user available balance
    end
```

---

## Design Decisions

1. **Immediate Webhook Response**: Webhooks acknowledge with `200 OK` within 50ms after saving the raw event payload to `WebhookEventLog`, moving verification to a background worker to avoid HTTP gateway timeouts.
2. **Database Locks on Payouts**: Uses `SELECT ... FOR UPDATE` SQL locks in `PayoutWorker` to eliminate race conditions when deducting user wallet balances.

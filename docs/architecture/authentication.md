# Authentication Subsystem

## Purpose

The authentication subsystem manages user identification, registration, session tracking, multi-device security, and token lifecycle management. It enforces strict HTTP-only cookie security, password hashing, stateless short-lived access tokens, and stateful refresh token rotation with single-use reuse detection.

---

## Participating Modules & Files

* **Controller**: `src/modules/identity/auth/auth.controller.ts`
* **Services**: 
  - `src/modules/identity/auth/auth.service.ts`
  - `src/modules/identity/auth/services/token.service.ts`
  - `src/modules/identity/auth/services/hash.service.ts`
  - `src/modules/identity/auth/services/session-cleanup.processor.ts`
* **Strategies**:
  - `src/modules/identity/auth/strategies/jwt.strategy.ts`
* **Guards**:
  - `src/modules/identity/auth/guards/jwt-auth.guard.ts`
* **Prisma Models**: `User`, `Session`, `PasswordResetToken`

---

## Token Architecture & Specifications

VetsBridge implements a **dual-token HTTP-Only cookie model**:

| Property | Access Token (`accessToken`) | Refresh Token (`refreshToken`) |
| :--- | :--- | :--- |
| **Type** | Stateless JWT | Stateful DB-backed JWT |
| **Lifetime** | 15 Minutes (`15m`) | 7 Days (`7d`) |
| **Secret** | `JWT_ACCESS_SECRET` | `JWT_REFRESH_SECRET` |
| **Payload Contents** | `{ sub: userId, email }` | `{ sub: userId, email, sid: sessionId }` |
| **Cookie Flags** | `httpOnly: true`, `secure: true`, `sameSite: 'strict'/'none'` | `httpOnly: true`, `secure: true`, `sameSite: 'strict'/'none'` |
| **Storage Location** | Browser Cookie | Browser Cookie + DB `Session` table (hashed) |

---

## Request Flow Diagrams

### 1. User Login Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant Ctrl as AuthController
    participant Auth as AuthService
    participant Token as TokenService
    participant Hash as HashingService
    participant DB as PostgreSQL (Prisma)

    User->>Ctrl: POST /v1/auth/login { email, password }
    Ctrl->>Auth: login(loginDto, context)
    Auth->>DB: findByEmail(email)
    DB-->>Auth: Return User entity with passwordHash
    Auth->>Hash: verify(passwordHash, password)
    alt Invalid Password
        Hash-->>Auth: false
        Auth-->>User: 401 Unauthorized
    else Valid Password
        Hash-->>Auth: true
        Auth->>Token: issueAuthTokens(userId, email, context)
        Token->>Hash: hash(refreshToken)
        Token->>DB: session.create({ id: sessionId, userId, refreshTokenHash, ... })
        Token-->>Auth: { accessToken, refreshToken }
        Auth-->>Ctrl: { user, tokens }
        Ctrl->>User: Set HTTP-Only cookies (accessToken, refreshToken) + 200 OK
    end
```

### 2. Refresh Token Rotation & Reuse Detection Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client Browser
    participant Ctrl as AuthController
    participant Token as TokenService
    participant Hash as HashingService
    participant DB as PostgreSQL (Prisma)

    Client->>Ctrl: POST /v1/auth/refresh (Cookie: refreshToken)
    Ctrl->>Token: issueFreshAuthTokens(refreshToken, context)
    Token->>Token: Verify JWT signature & expiration using JWT_REFRESH_SECRET
    Token->>DB: session.findUnique({ where: { id: payload.sid } })
    
    alt Session Not Found / Revoked / Expired
        DB-->>Token: null or isRevoked === true
        Token-->>Client: 401 Unauthorized ("Session is invalid or expired")
    else Session Active
        Token->>Hash: verify(session.refreshTokenHash, refreshToken)
        alt Hash Mismatch (Token Reuse Detected!)
            Hash-->>Token: false
            Token->>DB: session.update({ where: { id: payload.sid }, data: { isRevoked: true } })
            Token-->>Client: 401 Unauthorized ("Token verification failed")
        else Hash Valid
            Hash-->>Token: true
            Token->>Hash: hash(newRefreshToken)
            Token->>DB: $transaction([ revoke old sid, create new sid ])
            Token-->>Ctrl: { newAccessToken, newRefreshToken }
            Ctrl->>Client: Set updated HTTP-Only cookies + 200 OK
        end
    end
```

### 3. Logout & Global Session Revocation

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client Browser
    participant Ctrl as AuthController
    participant Auth as AuthService
    participant Token as TokenService
    participant DB as PostgreSQL (Prisma)

    Client->>Ctrl: POST /v1/auth/logout (Cookie: refreshToken)
    Ctrl->>Auth: logout(refreshToken)
    Auth->>Token: revokeSession(refreshToken)
    Token->>Token: Verify JWT payload to extract `sid`
    Token->>DB: session.delete({ where: { id: payload.sid } })
    Ctrl->>Client: res.clearCookie('accessToken'), res.clearCookie('refreshToken') + 200 OK
```

---

## Design Decisions

1. **HTTP-Only Cookies Over LocalStorage**: Tokens are never exposed to client-side JavaScript execution, eliminating token theft risks from XSS vulnerabilities.
2. **Atomic Session Rotation**: Every refresh call revokes the existing session ID and issues a brand-new session ID within a single `prisma.$transaction`, eliminating race conditions.
3. **Automatic Reuse Detection**: Presenting a previously rotated refresh token triggers an security violation alert, instantly revoking the session tree.
4. **Password Reset Global Revocation**: Resetting a password invalidates all active user sessions across all devices simultaneously via `session.updateMany({ where: { userId }, data: { isRevoked: true } })`.

---

## Failure Scenarios

* **Database Offline during Refresh**: Refresh attempt fails with `500 Server Error`. Active access tokens remain valid until their 15-minute expiration timestamp.
* **Expired Refresh Token**: `jwtService.verifyAsync` throws `UnauthorizedException`, requiring the user to re-authenticate cleanly.

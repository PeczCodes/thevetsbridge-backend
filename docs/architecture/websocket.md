# WebSocket Infrastructure Subsystem

## Purpose

The WebSocket infrastructure provides real-time bi-directional telemetry and event streaming for live telemedicine consultations, live chat messaging, presence indicators, call status updates, and synchronized session termination.

---

## Participating Modules & Files

* **Gateway**: `src/modules/telemedicine/gateways/telemedicine.gateway.ts`
* **Namespace**: `/telemedicine`
* **Services**: `ConsultationsService`, `DirectMessagingService`, `UsersService`
* **Frontend Integration**: `components/consultation-chat.tsx`, `components/socket-notification-manager.tsx`

---

## WebSocket Connection & Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client Browser
    participant Gateway as TelemedicineGateway (/telemedicine)
    participant Service as ConsultationsService
    participant DB as PostgreSQL (Prisma)

    Client->>Gateway: Connect wss://.../telemedicine (Header Bearer or Cookie)
    Gateway->>Gateway: Extract accessToken from auth header or cookie
    Gateway->>Gateway: Verify JWT signature using JWT_ACCESS_SECRET
    alt Token Missing or Invalid
        Gateway-->>Client: Disconnect socket (Unauthorized)
    else Token Valid
        Gateway->>DB: findById(userId)
        alt User Inactive or Suspended
            Gateway-->>Client: Disconnect socket
        else User Valid
            Gateway->>Gateway: Store user payload in socket.data.user
            Gateway->>Gateway: Join user room `user:${userId}`
            Gateway-->>Client: Connection Accepted
        end
    end

    Client->>Gateway: emit('join_consultation', { consultationId })
    Gateway->>Service: isParticipant(userId, consultationId)
    alt Unauthorized Participant
        Service-->>Gateway: false
        Gateway-->>Client: emit('error', 'Not authorized')
    else Authorized Participant
        Service-->>Gateway: true
        Gateway->>Gateway: Join room `consultation:${consultationId}`
        Gateway-->>Client: emit('joined_room', { room })
    end
```

---

## Socket Event Catalog

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join_consultation` | Client ➔ Gateway | `{ consultationId }` | Request to join room `consultation:${id}` |
| `send_consultation_message` | Client ➔ Gateway | `{ consultationId, content }` | Dispatch real-time chat message |
| `consultation_message` | Gateway ➔ Client | `ChatMessage DTO` | Broadcast new message to room participants |
| `consultation.completed` | Gateway ➔ Client | `{ consultationId }` | Signals veterinarian ended call; triggers auto-redirect |
| `consultation.cancelled` | Gateway ➔ Client | `{ consultationId }` | Signals session cancellation; resets global call widget |

---

## Failure Scenarios & Resilience

* **Network Disconnection**: Socket.io automatically falls back from WebSocket to Polling transports.
* **Reconnection Auto-Join**: Upon reconnecting, the client re-emits `join_consultation` to re-enter the room.

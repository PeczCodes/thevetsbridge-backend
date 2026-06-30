The platform must support three distinct layers of communication between users and veterinary doctors (vets).

These layers are NOT interchangeable and must be strictly separated in both backend logic and UI.

The goal is to balance:

medical safety
monetization
scalability
workload control for vets
🩺 1. Scheduled Consultation (Primary Medical Layer)

This is the core telemedicine feature of the platform.

Definition:

A scheduled, time-bound, paid medical session between a user and a vet.

Characteristics:
Must be booked in advance
Must be paid or authorized before activation
Can include:
video call (LiveKit)
real-time chat
Strictly linked to a Consultation entity
Fully auditable (medical-grade record)
Can generate prescriptions
Rules:
Only participants of the consultation can access communication
Communication ends when consultation is marked completed
All actions must be logged for audit purposes
💬 2. Follow-up Chat (Post-Consultation Support Layer)

This is an extension of a completed consultation, not a standalone feature.

Definition:

A time-limited chat window allowing follow-up questions after a paid consultation.

Characteristics:
Automatically created after consultation completion
Linked to the original Consultation
Has a defined expiration period (e.g. 3–7 days)
May be included in consultation price or treated as bundled support
Does NOT support video calls
Lightweight messaging only
Rules:
Only users involved in the original consultation can access it
Access automatically expires after expiresAt
Used strictly for clarification or follow-up questions, not new diagnoses
💰 3. Direct Vet Messaging (Optional Monetized Layer)

This is a standalone asynchronous communication model.

Definition:

A direct messaging channel between a user and a vet outside of scheduled consultations.

Characteristics:
Independent of consultation system
Can be:
paid per message
subscription-based
or free within limited constraints
Supports asynchronous messaging only (no video)
Can be used for non-urgent inquiries
Rules:
Must enforce rate limits or pricing rules to prevent abuse
Vet must explicitly opt into availability for direct messaging
Must be clearly distinguished from consultation sessions in UI
⚖️ System Design Constraints
❌ Forbidden Behavior:
Unlimited free vet chat without constraints
Treating all chat as equal medical communication
Using direct messaging as a replacement for consultations
❌ Anti-patterns:
bypassing consultation booking via chat
mixing follow-up chat with new diagnosis workflows
exposing medical decisions outside structured flows
🧠 Core Design Principle

All vet communication must map into one of the following:

Consultation (paid, structured, real-time)
Follow-up chat (bounded extension of consultation)
Direct messaging (controlled, monetized async communication)

No other communication paths are allowed.

🧩 System Integration Notes
Consultation layer must integrate with:
LiveKit (video/audio)
Chat system (real-time messaging)
Follow-up and messaging layers must use:
persistent message store
expiration logic where applicable
All communication layers must enforce:
authentication
authorization (ABAC rules)
audit logging
🚀 Final Intent

This structure ensures:

vets are protected from overload
users still have post-care support
platform maintains strong monetization structure
medical workflows remain safe and structured
system scales cleanly into subscriptions or AI-assisted care
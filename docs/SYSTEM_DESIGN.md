---
layout: default
title: System Design
nav_order: 1
permalink: /
description: Architecture, booking rules, and limits of the Unified Service Scheduler.
---

# System Design — Unified Service Scheduler

The shipped demo is a modular monolith: a React client, a NestJS API, and PostgreSQL, packaged as one Docker image. This page describes the implemented system and the production controls required to operate it safely. Requirements that are designed but not implemented in the challenge build are labelled **Production design**.

The running demo is [https://keyloop-service-scheduler-29lh.onrender.com/](https://keyloop-service-scheduler-29lh.onrender.com/). `GET /api/health` on that host returns `{"status":"ok"}`.

## 1. Purpose

A service advisor books a vehicle into a dealership for a timed service. The system must show whether a bay and a qualified technician are free, then confirm the appointment without giving the same bay or the same technician to two overlapping bookings.

## 2. Context

The advisor uses a browser. The scheduler application is the only system in the demo. PostgreSQL is the system of record for confirmed bookings.

```mermaid
flowchart TB
  Advisor["Service advisor"]:::actor
  App["Scheduler app"]:::app
  DB[("PostgreSQL")]:::data
  Advisor --> App --> DB
  classDef actor fill:#E8F1FF,stroke:#1D4E89,color:#1D4E89
  classDef app fill:#E7F6EF,stroke:#0F6E56,color:#0F6E56
  classDef data fill:#FFF6E8,stroke:#8A5A00,color:#6B4500
```

**Legend.** Blue is a person, green is the application, amber is stored data. Later diagrams use the same colors. Purple is a decision. Red is a rejected booking.

## 3. Scope

In scope for the demo:

- Choose a dealership, a seeded vehicle, a service type, and a timezone-aware start.
- Advisory availability for that dealership, without holding the bay or the technician.
- A confirmed appointment stored in PostgreSQL.
- A list of appointments in the UI, refreshed after a successful booking.

The challenge build signs advisors in with demo bearer tokens and limits each advisor to one dealership. It does not yet enforce business hours, breaks, bay suitability, appointment edits, cancellations, holidays, or a real OpenID Connect provider. Those controls are specified in [section 10](#10-production-requirements-and-controls).

## 4. Architecture

One Node 22 process on Render in Singapore serves the API and the built React assets. The advisor and PostgreSQL sit outside that process. Inside it, NestJS accepts the request, the scheduler owns the booking rules, and TypeORM talks to PostgreSQL.

<iframe src="{{ '/diagrams/scheduler-runtime.html' | relative_url }}" title="Scheduler runtime" style="width: 100%; height: 1080px; border: 1px solid #e6e6e6; border-radius: 8px;"></iframe>

[Open the runtime diagram]({{ '/diagrams/scheduler-runtime.html' | relative_url }}) if the frame is too small. The figure has one path: advisor, React UI, Render web, the Node process, NestJS API, scheduler, TypeORM, then PostgreSQL. The Render region wraps the web service and the process. The Node process is the inner trust boundary. Supporting limits, including no authentication and the dealership lock, are on the diagram cards rather than extra arrows.

| Part | Responsibility |
| --- | --- |
| React | Appointment entry, availability, confirmation, and history. |
| TanStack Query | Request state, and cache invalidation for the appointment list after a confirmed booking. |
| NestJS | Validate the request body and call the scheduler service. |
| TypeORM | Map dealerships, customers, vehicles, service types, bays, technicians, technician skills, and appointments. |
| PostgreSQL | Store confirmed bookings. Serialize booking transactions. |
| Docker | Same image locally (`docker compose up --build`, port 3000) and on Render. |

A modular monolith is the chosen shape: it avoids network calls between services for a small challenge, and it keeps a UI layer, an API layer, and a service layer. NestJS supplies dependency injection and the REST surface. React and TanStack Query keep remote state out of the component's own bookkeeping. PostgreSQL supplies transactional correctness.

## 5. Booking

Desired start is an instant. The UI reads a local date-time and sends that clock time with an explicit numeric offset (`apps/web/src/time.ts`). It does not send `Date.toISOString()`. The service treats the stored `timestamptz` values as instants.

Overlap is half-open. An existing confirmed appointment conflicts when `existing.start < requested.end` and `existing.end > requested.start`. Touching endpoints do not conflict: 10:00–11:00 may sit beside 11:00–12:00. The unit test in `apps/api/src/scheduler/scheduler.service.spec.ts` covers that pair of cases. Only rows with status `confirmed` at the same dealership are considered.

Duration comes from the service type. The requested end is start plus `durationMinutes`. Candidate resources are active bays at that dealership, and active technicians at that dealership who have a skill row for that service type. Stable first-fit is the intended demo assignment policy: choose the lowest-id free bay and lowest-id qualified free technician. It is deterministic and easy to explain, although a production rollout should measure load distribution before retaining it.

Confirm runs from the advisor through the React UI and the NestJS API into one database transaction. The dealership lock is held while the bay and technician are rechecked. Both free saves a confirmed row. Either busy returns HTTP 409. The diagram opens in Live.

<iframe src="{{ '/diagrams/booking-runtime.html' | relative_url }}" title="Booking runtime" style="width: 100%; height: 1080px; border: 1px solid #e6e6e6; border-radius: 8px;"></iframe>

[Open the booking diagram]({{ '/diagrams/booking-runtime.html' | relative_url }}) if the frame is too small.

1. The advisor chooses dealership, vehicle, service type, and start.
2. Availability loads the service duration and the candidate bays and qualified technicians. It does not take a lock and it does not insert a row. The result is advisory.
3. The overlap test above decides whether each candidate is free for the whole interval.
4. Booking opens a `READ COMMITTED` transaction and takes `pg_advisory_xact_lock(dealershipId)`. The lock is held until the transaction ends, so two bookings for the same dealership cannot both pass the recheck.
5. Inside the lock the service loads the vehicle, the service type, and the free bay and technician again. It refuses the booking when either resource is missing.
6. On success it inserts one appointment: the vehicle's customer, the chosen bay and technician, the computed end, and status `confirmed`. PostgreSQL exclusion constraints on the bay and technician ranges reject a conflicting confirmed row even if a writer skips the advisory lock. The UI then invalidates the appointment query and reloads the current date window. A repeated create with the same `Idempotency-Key` and body returns the original appointment; a different body for that key returns HTTP 409.

A conflict throws NestJS `ConflictException` with the message `Technician or service bay unavailable for entire appointment`, which the API returns as HTTP 409. Unknown dealership, vehicle, or service type is HTTP 404. Identifiers must be integers greater than zero. `startAt` must be a future ISO 8601 instant with `Z` or an explicit offset; optional seconds and fractional seconds are accepted, including the millisecond form produced by `Date.toISOString()`.

The availability response includes `available`, `startAt`, `endAt`, `durationMinutes`, `serviceBay`, and `technician`. Either resource is null when that side is busy. `available` is true only when both are present.

## 6. Data

Schema changes use versioned TypeORM migrations with `synchronize: false` in every environment. The baseline migration is idempotent so it can adopt the original demo database as well as create an empty database. Entity relations and database foreign keys use restrictive deletion for booked business records and cascading deletion only for technician-skill join rows. Check constraints require positive service duration, a positive appointment interval, and a known appointment status. Partial interval indexes support the overlap query.

```mermaid
flowchart TB
  D["Dealership"]:::data --> Bay["Service bay"]:::data
  D --> Tech["Technician"]:::data
  Tech --> Skill["Technician skill"]:::data
  Svc["Service type"]:::data --> Skill
  classDef data fill:#FFF6E8,stroke:#8A5A00,color:#6B4500
```

```mermaid
flowchart TB
  Appt["Appointment"]:::data --> Veh["Vehicle"]:::data
  Veh --> Cust["Customer"]:::data
  Appt --> Svc["Service type"]:::data
  classDef data fill:#FFF6E8,stroke:#8A5A00,color:#6B4500
```

An appointment also stores `dealershipId`, `serviceBayId`, `technicianId`, `startAt`, `endAt`, and `status`. The customer on the appointment is copied from the vehicle at booking time. The advisor does not pick a customer separately.

Seed data is illustrative. Catalog rows are inserted only when `SEED=true` and the dealership table is empty. Demo users are inserted when `SEED=true` or `DEMO_AUTH=true`. Both run under a transaction advisory lock so two processes starting together create one catalog (`apps/api/src/seed/seed.ts`):

- Two dealerships, both in Ho Chi Minh City.
- One customer, `demo@example.com`, who owns both sample vehicles.
- Three service types: 60, 90, and 120 minutes.
- Two active bays and two active technicians per dealership. Each technician is skilled for every service type.
- Demo sign-in: `coordinator`, `central.advisor`, and `riverside.advisor`, all with password `scheduler-demo`. Advisors carry one dealership. The coordinator can use both. Email addresses are stored for the seed customer and are not returned by the catalog.

An advisor token carries one dealership id, so the catalog and diary stay inside that workshop. A coordinator token carries both dealership ids. A request for the other workshop returns HTTP 403 and does not become a data flow. The catalog returns customer id and name. Vehicle registration still travels with the catalog because the booking screen shows it. The arrows labelled “both workshops” and “own visits” cross; follow the labels. The figure covers sign-in and the records each role receives. It leaves out the booking write, the dealership lock, and idempotency.

<iframe src="{{ '/diagrams/role-dataflow.html' | relative_url }}" title="Booking data by role" style="width: 100%; height: 1080px; border: 1px solid #e6e6e6; border-radius: 8px;"></iframe>

[Open the role data-flow diagram]({{ '/diagrams/role-dataflow.html' | relative_url }}) if the frame is too small.

## 7. Interfaces

Sign-in is `apps/api/src/auth/auth.controller.ts`. Liveness, readiness, and metrics are `apps/api/src/health/health.controller.ts`. Catalog, availability, and appointments are `apps/api/src/scheduler/scheduler.controller.ts`. JSON field names on a booking body are `dealershipId`, `vehicleId`, `serviceTypeId`, and `startAt`. Extra fields are rejected.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/live` | Process liveness. Does not touch PostgreSQL. Includes service version and commit. |
| `GET` | `/api/health` | Readiness. Runs `SELECT 1`. Returns `status`, `database`, service version, and commit only when PostgreSQL answers. |
| `GET` | `/api/metrics` | Prometheus text for HTTP, booking outcomes, and advisory-lock wait. Open only outside production unless `METRICS_TOKEN` matches the bearer token. Counters are process-local until a scraper stores them. |
| `POST` | `/api/session` | Demo sign-in. Returns a signed bearer token for one role and its dealerships. |
| `GET` | `/api/catalog` | Dealerships the caller may use, customer id and name, vehicles, and service types. Requires a bearer token. |
| `POST` | `/api/availability` | Advisory check for a dealership the caller may use. No lock and no insert. |
| `POST` | `/api/appointments` | Book inside the dealership lock, or HTTP 409. Optional `Idempotency-Key` header. |
| `GET` | `/api/appointments` | One page of appointments inside a required `from`/`to` window of at most 93 days. Optional `dealershipId` must be one of the caller's dealerships. `limit` is at most 50. `nextCursor` continues the page. |

The diary loads that window, follows cursors up to 500 rows, and can extend the window. It does not download the full history, and it is not limited to seven rows.

Example body from the README: `{"dealershipId":1,"vehicleId":1,"serviceTypeId":1,"startAt":"2026-12-01T09:00:00+07:00"}`.

## 8. Deployment and observability

`Dockerfile` builds the web app and the API, then runs `node dist/main.js` on port 3000 with the React build in `public`. Compose starts PostgreSQL 17 and the app. The app waits until Postgres is accepting connections.

Render runs that image as the web service `keyloop-service-scheduler` in Singapore on the free plan (`render.yaml`). The platform health check uses `/api/health`. `DATABASE_URL` is set in the Render environment to the database internal URL and is not stored in this repository. `render.yaml` does not create the database, backups, or a metrics backend. A free Render web service cold-starts after about 15 minutes without traffic. A free Render Postgres database expires after 30 days. Neither meets the recovery targets in section 10.

`DB_SSL=true` uses TLS and verifies the server certificate. Certificate verification is disabled only when `DB_SSL_REJECT_UNAUTHORIZED=false` is set explicitly, and that choice is logged. Database connect and statement time are bounded (5 seconds to connect, 8 seconds per statement). The browser cancels a request after 10 seconds.

Migrations do not run inside TypeORM startup. `RUN_MIGRATIONS` is not `false` by default, and the runner takes a PostgreSQL advisory lock so replicas apply each migration once. Production replicas beyond the first should set `RUN_MIGRATIONS=false` and run `node dist/migrate.js` as the release step. The single free-plan service keeps `RUN_MIGRATIONS=true`.

Every API response carries `x-correlation-id` and W3C `traceparent`. A valid caller correlation id and trace id are preserved. Completion logs are structured JSON and include service, version, commit, correlation id, trace id, span id, route, status, and duration. Booking, conflict, replay, and database spans log the same trace id. If `OTEL_EXPORTER_OTLP_ENDPOINT` is set, spans are posted to `{endpoint}/v1/traces`. Nothing in this repository scrapes metrics, stores logs, or pages anyone. The in-memory counters reset on restart.

`GET /api/live` is liveness and does not touch the database. `GET /api/health` is readiness because it executes `SELECT 1`. A database outage must not be used as a liveness check or the platform can restart the process in a loop.

**Production alert policy.** This policy is not implemented. No dashboard or pager is configured. The intended policy is to page when readiness fails for 3 consecutive minutes, HTTP 5xx exceeds 2% for 5 minutes with at least 50 requests, booking p95 exceeds 500 ms for 10 minutes, or no successful booking is observed during a known busy period. Ticket-level alerts cover monthly SLO burn, backup failure, capacity above 70%, and certificate/secret expiry within 14 days.

CI on GitHub Actions runs the Jest suite, the TypeScript build, and a Docker image build. A second workflow monitors the Render service; Render itself deploys pushes to `main`.

## 9. Decisions

| Topic | Decision |
| --- | --- |
| Shape | Modular monolith. One deployable process. |
| Contention | One PostgreSQL advisory transaction lock per dealership, then a recheck. Chosen as a direct control for this small service, aimed at the race between the advisory check and confirm. |
| Isolation | `READ COMMITTED` plus that lock. The lock, not the isolation level alone, stops two overlapping confirms for one dealership. |
| Overlap | Half-open interval. Adjacent appointments are allowed. |
| Assignment | Lowest id among active, skilled, non-overlapping resources. |
| Schema changes | Versioned TypeORM migrations; `synchronize` is disabled. |
| Time | Instants in `timestamptz`. The client sends local clock time with an explicit offset. |
| Non-overlap | Application recheck plus PostgreSQL exclusion constraints for confirmed bay and technician ranges. |
| Retries | Optional idempotency key stored with the request hash and the saved appointment. |
| Identity | Demo HMAC bearer tokens. Advisors are scoped to one dealership. OpenID Connect is not implemented. |

## 10. Production requirements and controls

The following targets define the production acceptance criteria. They are not claims about the free-tier demo.

### Service levels, recovery, and capacity

- **Latency:** monthly p95 below 300 ms for catalog and availability, below 500 ms for booking, and p99 below 1 second, measured at the API edge and excluding client network time.
- **Availability:** 99.9% monthly for availability and booking APIs. Planned maintenance announced at least 48 hours ahead is excluded; database and hosting failures are included.
- **Recovery:** PostgreSQL point-in-time recovery with encrypted daily backups, a recovery point objective of 5 minutes, and a recovery time objective of 30 minutes. Perform and record a restore exercise every quarter.
- **Capacity:** initial sizing is 50 dealerships, 200 concurrently active advisors, 20 booking attempts per second for a 5-minute burst, and 5 million retained appointments. Load tests must prove the latency targets at 150% of this baseline. Scale up at 70% sustained database CPU, connection-pool use, or storage IOPS, and reassess advisory-lock contention by dealership.

### Scheduling policy

- Each dealership has an IANA timezone, weekly opening intervals, and dated closure intervals for holidays or exceptional closures. The entire appointment must fit in one open interval after conversion from the submitted instant; daylight-saving transitions use the timezone database.
- Technician breaks, training, leave, and bay maintenance are half-open unavailability intervals. They participate in the same overlap calculation as confirmed appointments.
- Service types declare required bay capabilities; bays declare their capabilities. A bay is a candidate only when it contains every capability required by the service.
- Rescheduling uses `PATCH /appointments/:id` with an `If-Match` version. It takes the dealership lock, validates the new interval, reallocates resources using the normal policy, and updates atomically. A stale version returns 412 and unavailable resources return 409.
- Cancellation uses `POST /appointments/:id/cancel` with a reason and idempotency key. It takes the dealership lock, changes `confirmed` to `cancelled`, releases the slot immediately, and returns the existing result on retries. Confirmed appointments are never physically deleted.
- Every create, reschedule, and cancellation writes an immutable audit event containing actor, dealership, prior and new values, timestamp, correlation id, and reason.

### Identity, authorization, and personal data

- Advisors authenticate with the organization's OpenID Connect provider using Authorization Code with PKCE. The API validates short-lived signed access tokens by issuer, audience, expiry, and key id. Service-to-service clients use separate credentials; shared API keys are prohibited.
- Roles are `advisor` (read and create within assigned dealerships), `service-manager` (also reschedule and cancel), and `platform-admin` (configuration only). Dealership ids come from token scopes and are checked on every query and mutation; a body or query parameter cannot expand access.
- TLS is required in transit. PostgreSQL volumes and backups are encrypted at rest. Secrets live in the deployment secret store and rotate at least every 90 days.
- Customer name, email, registration, and appointment history are personal data. They are excluded from application logs and metrics, masked in support views, and available only to dealership-scoped roles. Production responses return only fields needed by the current screen.
- Retain appointments and audit records according to the approved regional policy, then delete or irreversibly anonymize personal fields. Fulfil access and erasure requests through audited workflows, subject to legal retention holds. Backups expire on the same documented schedule.
- Security events include failed authentication, denied dealership access, privilege changes, bulk export, and unusual lookup volume. Send them to the centralized security log with tamper-resistant retention.

### Verification status

The automated suite covers half-open adjacency, UTC milliseconds, explicit timezone offsets, rejection of offset-free local time, a mocked concurrent booking, and — when `DATABASE_URL` is set — the same concurrent booking, an adjacent booking, a direct overlapping insert, idempotency replay, and advisor dealership denial against PostgreSQL. CI runs that PostgreSQL job and applies migrations twice. Restore drills and the capacity test above are not automated.

## 11. GenAI collaboration

AI was used to outline the architecture and to draft the initial data model, layer boundaries, API, concurrency approach, Docker setup, documentation, and React UI. Generated output stays subject to engineering review. The review focus is the race between availability and confirmation, transaction isolation, resource overlap, date-time validation, input validation, the Postgres connection, and deployment verification.

Per-dealership advisory transaction locks are the contention control adopted for this service. Failed installs, deployment errors, and later changes belong in the presentation as open items, not as validated behavior.

## Source map

| Claim | Source |
| --- | --- |
| Layers, lock, half-open overlap, advisory check, 409, health, demo limits | This design, checked against `apps/api/src/scheduler/scheduler.service.ts` and `scheduler.controller.ts` |
| Entities and foreign-key relations | `apps/api/src/database/entities.ts` |
| Migrations and static files | `apps/api/src/app.module.ts`, `apps/api/src/database/migrations/` |
| Seed contents | `apps/api/src/seed/seed.ts` |
| UI behavior | `apps/web/src/App.tsx` |
| Date, adjacent-slot, and concurrent-booking tests | `apps/api/src/scheduler/scheduler.service.spec.ts` |
| Image and local runtime | `Dockerfile`, `docker-compose.yml` |
| Render service, region, health path | `render.yaml`, `README.md` |

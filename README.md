# Unified Service Scheduler — Keyloop Scenario A

React + TanStack Query frontend, NestJS REST API and persistent PostgreSQL in one Dockerized monorepo.

## Run locally

```bash
docker compose up --build
```

Visit http://localhost:3000; GET /api/health returns `{"status":"ok"}`.

## API

- `GET /api/catalog` — dealerships, vehicles, services and customers
- `POST /api/availability` — advisory availability check
- `POST /api/appointments` — atomic booking with PostgreSQL transaction-level advisory locking per dealership
- `GET /api/appointments` — persisted appointment list

Example JSON: `{"dealershipId":1,"vehicleId":1,"serviceTypeId":1,"startAt":"2026-12-01T09:00:00+07:00"}`.

## Decisions and limitations

The appointment records reference a customer's existing vehicle. Technician skills are stored separately. The booking transaction serializes simultaneous requests for the same dealership and checks resource overlap for the entire duration. Service hours, cancellations, holidays, and authentication are intentionally out of scope for this demonstration. Time entries must include timezone offsets; the UI converts local input to UTC.

Development uses TypeORM `synchronize: true`; production systems should replace it with versioned migrations and stronger database constraints. Seed data is illustrative.

## Test

```bash
npm install
npm test
npm run build
```

## AI Collaboration Narrative

AI was used to outline the architecture and generate the initial implementation, API controller, concurrency-handling algorithm, Docker setup, documentation, and React interface. Key areas requiring engineering scrutiny include transaction isolation, resource overlap, date-time validation, input validation, Postgres connection handling, and full deployment verification. The implementation must be reviewed and tested before production use. Failed installs, deployment errors, and changes should be disclosed in the presentation rather than represented as validated.

## Architecture

See [System Design](docs/SYSTEM_DESIGN.md).
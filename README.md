# Unified Service Scheduler — Keyloop Scenario A

React + TanStack Query frontend, NestJS REST API and persistent PostgreSQL in one Dockerized monorepo.

## Public demo

**[Launch the Unified Service Scheduler](https://keyloop-service-scheduler-29lh.onrender.com/)** · [API health](https://keyloop-service-scheduler-29lh.onrender.com/api/health)

Deployed on Render (Singapore) using the Docker web service `srv-dbgd25rl550s738jtc9g` and a managed PostgreSQL database. Free-tier instances may require a cold start. A working public URL does not imply that the most recent commit has finished deploying; check the deployment tracker below.

## CI and Render deployment tracking

- [Build & Test](https://github.com/thongdn34/keyloop-coding-challenge/actions/workflows/ci.yml): verifies Jest tests, TypeScript builds and Docker image on pushes and pull requests.
- [Render Deployment Monitor](https://github.com/thongdn34/keyloop-coding-challenge/actions/workflows/render-deployment.yml): runs on changes to `main`, manual dispatch, and every six hours. Render **automatically deploys pushes to `main`**; this workflow monitors rather than triggering a duplicate deployment.
- Set the GitHub Actions repository secret `RENDER_API_KEY` (Render Dashboard → Account Settings → API Keys) to enable commit-specific tracking through Render's Deploy API. The key is never printed. Without it, the workflow performs only an HTTP availability smoke test and **cannot establish which commit was deployed**.
- Deployment-specific status can also be inspected in the [Render Dashboard](https://dashboard.render.com/web/srv-dbgd25rl550s738jtc9g). The Render web service must have `DATABASE_URL` set to the database's **Internal Database URL** via Render's Environment settings; never put credentials in this repository.


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

Published design: [Unified Service Scheduler system design](https://thongdn34.github.io/keyloop-coding-challenge/). Source: [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

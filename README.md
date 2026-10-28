# Unified Service Scheduler — Keyloop Scenario A

React + TanStack Query frontend, NestJS REST API and persistent PostgreSQL in one Dockerized monorepo.

## Public demo

**[Launch the Unified Service Scheduler](https://keyloop-service-scheduler-29lh.onrender.com/)** · [API health](https://keyloop-service-scheduler-29lh.onrender.com/api/health)

Deployed on Render (Singapore) using the Docker web service `srv-dbgd25rl550s738jtc9g` and a managed PostgreSQL database. Free-tier instances may require a cold start. A working public URL does not imply that the most recent commit has finished deploying; check the deployment tracker below.

## CI and Render deployment tracking

- [Build & Test](https://github.com/thongdn34/keyloop-coding-challenge/actions/workflows/ci.yml): verifies Jest tests, Playwright end-to-end tests, TypeScript builds and the Docker image on pushes and pull requests.
- [Render Deployment Monitor](https://github.com/thongdn34/keyloop-coding-challenge/actions/workflows/render-deployment.yml): runs on changes to `main`, manual dispatch, and every six hours. Render **automatically deploys pushes to `main`**; this workflow monitors rather than triggering a duplicate deployment.
- Set the GitHub Actions repository secret `RENDER_API_KEY` (Render Dashboard → Account Settings → API Keys) to enable commit-specific tracking through Render's Deploy API. The key is never printed. Without it, the workflow performs only an HTTP availability smoke test and **cannot establish which commit was deployed**.
- Deployment-specific status can also be inspected in the [Render Dashboard](https://dashboard.render.com/web/srv-dbgd25rl550s738jtc9g). The Render web service must have `DATABASE_URL` set to the database's **Internal Database URL** via Render's Environment settings; never put credentials in this repository.


## Run locally

```bash
docker compose up --build
```

Visit http://localhost:3000 and sign in. The demo password is `scheduler-demo` for `coordinator`, `central.advisor`, and `riverside.advisor`. `GET /api/health` verifies PostgreSQL and returns status, database, service version, and commit. `GET /api/live` does not touch the database.

`SEED=true` loads the sample catalog only when the database is empty. `DEMO_AUTH=true` ensures the three demo users exist. Both are set by Docker Compose. Set `AUTH_SECRET` (at least 32 characters) before using real customer data. Set `RUN_MIGRATIONS=false` on extra replicas and run `npm run migrate` once per release.

## API

- `POST /api/session` — demo sign-in; other data routes require `Authorization: Bearer`
- `GET /api/catalog` — dealerships the caller may use, vehicles, services, and customer names
- `POST /api/availability` — advisory availability check
- `POST /api/appointments` — booking under a dealership advisory lock, with optional `Idempotency-Key`
- `GET /api/appointments?from&to` — one page inside a date window of at most 93 days
- `GET /api/metrics` — Prometheus request, booking, and lock-wait metrics; production requires `METRICS_TOKEN`

Example JSON: `{"dealershipId":1,"vehicleId":1,"serviceTypeId":1,"startAt":"2026-12-01T09:00:00+07:00"}`.

## Decisions and limitations

The appointment records reference a customer's existing vehicle. Technician skills are stored separately. The booking transaction serializes simultaneous requests for the same dealership, picks the lowest-id free bay and qualified technician in SQL, and PostgreSQL exclusion constraints reject overlapping confirmed assignments. Service hours, cancellations, and holidays are specified in the system design and are not implemented. Sign-in is a demo bearer token, not OpenID Connect. Time entries must include timezone offsets; the UI sends the local clock time with that offset.

The free Render service can cold-start after inactivity. `render.yaml` does not provision PostgreSQL or backups. A free Render database expires after 30 days. Metrics stay in process memory unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set for traces and an external system scrapes `/api/metrics`. The alert policy in the system design is not wired up.

All environments use versioned TypeORM migrations with schema synchronization disabled. Foreign keys, interval checks, and overlap-query indexes are declared in the baseline migration. Seed data is illustrative.

## Test

```bash
npm ci
npx playwright install chromium
npm test
npm run test:web
npm run build
npm run e2e
npm run e2e:ui -w @scheduler/web
```

`npm test` runs the API unit tests. If `DATABASE_URL` points at PostgreSQL, it also runs the concurrency, exclusion, idempotency, and authorization tests. CI provides that database. `npm run test:web` checks the time conversion, diary ordering, and API client without a browser. `npm run e2e` runs the Playwright suites in `e2e/` for resource-constrained booking, the real-time bay and technician check, and the persisted appointment. The runner uses http://localhost:3000 when the app is already up, and otherwise starts it with `docker compose up --build`. `npm run e2e:ui -w @scheduler/web` opens Playwright UI mode for those same suites.

## AI Collaboration Narrative

AI was used to outline the architecture and generate the initial implementation, API controller, concurrency-handling algorithm, Docker setup, documentation, and React interface. Key areas requiring engineering scrutiny include transaction isolation, resource overlap, date-time validation, input validation, Postgres connection handling, and full deployment verification. The implementation must be reviewed and tested before production use. Failed installs, deployment errors, and changes should be disclosed in the presentation rather than represented as validated.

## Architecture

Published design: [Unified Service Scheduler system design](https://thongdn34.github.io/keyloop-coding-challenge/). Source: [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

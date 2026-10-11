# AEGIS

AEGIS tracks daily decision load and schedules protected time. Users log notifications, app switches, replies, and form inputs; the dashboard shows their estimated cost against a daily capacity of 100 points.

## Stack

- React frontend, built with Vite and served by Nginx.
- Node 24 API with SQLite, scrypt password hashing, and signed eight-hour sessions.
- Docker Compose with persistent database storage and health checks.
- Optional Caddy gateway for public HTTPS.
- An alternative Spring Boot API in `backend/`.

## Run with Docker

Start Docker Desktop, then run:

```sh
docker compose up -d --build --wait
```

Open http://127.0.0.1:8081. The API is internal to the Docker network. Accounts, events, and session keys persist in the `local-data` volume.

```sh
docker compose ps
docker compose logs --tail 100
docker compose down
```

Removing volumes deletes saved data. The Docker database is separate from the development database.

For automatic Docker Desktop startup on Windows and deployment verification:

```sh
node scripts/start-docker.mjs
```

## Development

Requires Node 24 or later.

```sh
npm ci --prefix frontend
npm run start:api
```

In another terminal:

```sh
npm run start:web
```

Open http://127.0.0.1:5173. Development data is stored in `local-api/data/`. To serve the compiled frontend without Docker, run `npm run build` followed by `npm run start:production`.

## Checks

Install Chromium once:

```sh
npm exec --prefix frontend -- playwright install chromium
```

Run the API tests and build:

```sh
npm run test:local
npm run build
```

With the frontend running, run `npm run test:ui`. With both services running, run `npm run test:live`. `TEST_URL` selects a different frontend address for browser tests.

`npm run deploy` builds and starts the Docker services, runs the live browser test, and verifies account, event, and session persistence after restarting the API. It creates test accounts and reports success only when all checks pass. Frontend dependencies and Chromium must be installed locally.

GitHub Actions runs the Docker, browser, API, and Spring checks on pushes to `main` and pull requests.

## Public HTTPS

For a temporary public link on a phone hotspot, run:

```sh
npm run publish:public
```

This runs Cloudflare's tunnel connector in Docker, keeps the HTTP listener on loopback, configures the exact HTTPS origin, and verifies the public app in Chromium and after an API restart. The verified URL is saved in `.runtime/public-url.txt`. Authentication limits use the visitor address supplied by Cloudflare.

Keep the computer, Docker, and internet connection running. Quick Tunnel addresses change after the tunnel restarts; rerun the command to update the configuration and obtain the new link. Quick Tunnels have no uptime guarantee and are intended for temporary access. A permanent address requires a named tunnel or a reachable server with a domain.

For manual Compose commands in tunnel mode, use `docker compose -f compose.yaml -f compose.tunnel.yaml`. Use one public mode at a time; remove `TUNNEL_ENABLED` and `DEPLOY_URL` from `.env` before switching to the direct domain setup below.

A direct public deployment requires a domain pointing to an internet-reachable Docker host and inbound TCP ports 80 and 443. A phone hotspot may require an outbound tunnel or a different network because carrier NAT prevents direct inbound access.

Add the following to an untracked `.env` file:

```dotenv
PUBLIC_DOMAIN=aegis.your-domain.com
```

Then run `npm run deploy`. The script includes `compose.public.yaml`, starts Caddy, and keeps the app's HTTP port local. Caddy manages HTTPS certificates in persistent volumes. For manual Compose commands in this mode, use `docker compose -f compose.yaml -f compose.public.yaml`.

Set `DEPLOY_URL=https://aegis.your-domain.com` to verify through the HTTPS endpoint. Local verification alone does not prove public reachability.

For direct HTTP network access, `.env.docker.example` documents the bind address, port, and allowed origins. `.env`, databases, session keys, logs, and caches are excluded from Git and Docker build contexts.

## Scoring

- Each day starts at 100 points in the account's timezone.
- Notifications cost 1 point, app switches 2, replies 3, and form inputs 4.
- Notification events are held from 15 minutes before a protect zone until it ends.
- Each released notification batch costs 1 point on the day the zone ends.
- Zones cannot overlap, including preparation time, and can be removed before preparation starts.
- The dashboard refreshes every 15 seconds.

## API

All routes use the `/api` prefix. Dashboard, event, and zone routes require a Bearer token.

| Method | Route | Input |
| --- | --- | --- |
| POST | `/auth/register` | `fullName`, `email`, `password`, `timezone` |
| POST | `/auth/login` | `email`, `password` |
| GET | `/dashboard` | Optional `date=YYYY-MM-DD` |
| POST | `/events` | `eventType` |
| POST | `/zones` | `title`, `startsAt`, `endsAt` (ISO timestamps) |
| DELETE | `/zones/{id}` | Zone ID |
| GET | `/health` | None |

## Spring Boot API

The alternative backend requires Java 17 or later and Maven. Stop the Node API before using it; both default to port 8080.

```sh
mvn -f backend/pom.xml test
```

Run `mvn spring-boot:run -Dspring-boot.run.profiles=dev` from `backend/` to use the H2 development database. For PostgreSQL, start `docker compose --profile spring up -d postgres` and configure `DB_URL`, `DB_USER`, `DB_PASSWORD`, and a random `JWT_SECRET` of at least 32 bytes. Set `FRONTEND_ORIGIN` to the frontend's address. The development profile's signing secret must not be used publicly.

## Scope

Events are logged manually or through the API. AEGIS does not monitor other apps or silence device notifications. It stores event types and times, not message content. Capacity is a scoring estimate, not a measure of cognitive ability.

Email verification, password recovery, database migrations, and device integrations are not implemented. Nginx limits authentication requests to reduce bursts; this does not replace a full abuse-prevention system. SQLite is intended for a single API instance.

# Development

## Docker

Start Docker Desktop, then run:

```sh
docker compose up -d --build --wait
```

The local frontend listens on port 8081. The API is internal to Docker. Accounts, events, and session keys persist in the `local-data` volume, separate from development data.

```sh
docker compose ps
docker compose logs --tail 100
docker compose down
```

Removing volumes deletes saved data. On Windows, `node scripts/start-docker.mjs` starts Docker Desktop and verifies the deployment.

## Local development

Requires Node 24 or later.

```sh
npm ci --prefix frontend
npm run start:api
```

In another terminal, run `npm run start:web`. Vite listens on port 5173; the API listens on port 8080. Development data is stored in `local-api/data/`. To serve a compiled frontend without Docker, run `npm run build`, then `npm run start:production`.

## Checks

Install Chromium once:

```sh
npm exec --prefix frontend -- playwright install chromium
```

```sh
npm run test:local
npm run build
npm run deploy
```

`npm run deploy` builds the Docker services, runs the live browser test, and checks that accounts, events, and sessions survive an API restart. It creates test accounts and requires local frontend dependencies and Chromium.

With the frontend running, use `npm run test:ui`. With both services running, use `npm run test:live`. `TEST_URL` selects a different frontend address. GitHub Actions runs the Docker, browser, API, and Spring checks on pushes to `main` and pull requests.

## Public deployment

For temporary public access, including from a phone hotspot:

```sh
npm run publish:public
```

The command runs Cloudflare's tunnel connector in Docker, restricts the HTTP listener to loopback, configures the HTTPS origin, and verifies the public app in Chromium and after an API restart. It saves the verified URL in `.runtime/public-url.txt`. Nginx uses the visitor address supplied by Cloudflare for authentication limits.

Keep the computer, Docker, and internet connection running. Rerun the command after a tunnel restart to configure the new address, and update the README's demo link. Quick Tunnels provide temporary access without an uptime guarantee; a permanent address needs a named tunnel or an internet-reachable server with a domain.

For manual commands in this mode, use `docker compose -f compose.yaml -f compose.tunnel.yaml`.

### Direct HTTPS with a domain

Use a domain pointing to an internet-reachable Docker host with inbound TCP ports 80 and 443. Phone hotspots may block inbound access through carrier NAT.

Remove `TUNNEL_ENABLED` and `DEPLOY_URL` from `.env` before switching modes. Add:

```dotenv
PUBLIC_DOMAIN=aegis.your-domain.com
DEPLOY_URL=https://aegis.your-domain.com
```

Run `npm run deploy`. It includes `compose.public.yaml` and starts Caddy, which stores HTTPS certificates in persistent volumes. For manual commands, use `docker compose -f compose.yaml -f compose.public.yaml`.

For direct HTTP access, see [`.env.docker.example`](../.env.docker.example). `.env`, databases, session keys, logs, and caches are excluded from Git and Docker build contexts.

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

Event types are `NOTIFICATION`, `APP_SWITCH`, `MESSAGE_REPLY`, and `FORM_INPUT`. Zones cannot overlap, including their 15-minute preparation time, and can be removed before preparation starts. Released notification batches cost 1 point on the day the zone ends. The dashboard refreshes every 15 seconds.

## Alternative Spring Boot API

Requires Java 17 or later and Maven. Stop the Node API first; both default to port 8080.

```sh
mvn -f backend/pom.xml test
```

From `backend/`, run `mvn spring-boot:run -Dspring-boot.run.profiles=dev` for H2 development storage. For PostgreSQL, start `docker compose --profile spring up -d postgres` and configure `DB_URL`, `DB_USER`, `DB_PASSWORD`, and a random `JWT_SECRET` of at least 32 bytes. Set `FRONTEND_ORIGIN` to the frontend's address. Use a separate signing secret for public deployments.

## Current limits

Email verification, password recovery, database migrations, and device integrations are not implemented. SQLite supports a single API instance. Nginx limits authentication bursts; broader abuse controls would be needed for a larger public service.

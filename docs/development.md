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
npm ci
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

### Vercel with a free persistent database

The root `vercel.json` deploys the React build and `api/index.mjs` as one public app. The API uses Turso remotely; Vercel's temporary filesystem is never used for accounts or session keys. Local development and Docker continue to use local SQLite.

1. Sign in with `vercel login` and link this repository's root directory to a project on your **Hobby** account with `vercel link`. Keep the framework preset **Other** and the root directory at the repository root; `vercel.json` supplies the build settings.
2. Create a **Free** Turso database through the [Vercel Marketplace](https://vercel.com/marketplace/tursocloud/database) or [Turso](https://app.turso.tech). Connect it to the Vercel project. Do not select a paid database or upgrade the Vercel plan.
3. Configure production `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `SESSION_SECRET` in Vercel's environment settings. Generate a random session secret of at least 32 bytes; retain the same secret across deployments. Never put secrets in Git or frontend variables. `.env.vercel.example` documents the variable names.
4. Run `npm run test:cloud` and `npm run build`, then `vercel --prod`. The first API invocation creates the schema in the database. Existing local accounts are not migrated automatically.
5. In the project's **Deployment Protection** settings, ensure the **production domain** allows anonymous visitors. Open that URL in an incognito window and check `/api/health`, registration, login, logged events, and protect zones. Run the live browser check with `TEST_URL` set to the public production URL. Redeploy and confirm saved accounts/activity still work before sharing the link.

Vercel's assigned production and deployment URLs are allowed automatically. For a custom domain, add its exact HTTPS origin to `FRONTEND_ORIGIN` in the project's environment settings and redeploy. Due notification batches are released on the next dashboard/event request instead of relying on a background process. No local server or Docker container needs to stay on.

The free plans have usage limits; review [Vercel Hobby](https://vercel.com/docs/plans/hobby) and [Turso pricing](https://turso.tech/pricing). Use the free tiers without paid upgrades. The Vercel upload allowlist excludes local databases, environment files, caches, and unrelated documents. A deployment is not verified until it returns a production URL and the public checks pass.

### Cloud hosting independent of your computer

The root `render.yaml` defines a Render web service for the compiled frontend and Node API, with a persistent 1 GB disk for SQLite and its session signing key. The paid server runs independently of your computer and provides a stable public HTTPS URL. The configured server is $7/month and disk storage is $0.25/GB/month at preparation time; review [current pricing](https://render.com/pricing) and the dashboard estimate before creating resources. Taxes and additional usage can increase the bill.

1. Push the reviewed deployment files and app changes to the GitHub repository.
2. Sign in to [Render](https://dashboard.render.com), choose **New > Blueprint**, and connect `Candypopppsss/AEGIS` with the branch containing `render.yaml`.
3. Review the paid service and persistent disk, then create the Blueprint. Wait for the service to become live.
4. Open the HTTPS URL shown in the Render dashboard and check `/api/health`. The hostname is assigned by Render; do not assume `aegis.onrender.com` is available.
5. Check registration, login, events, and protect zones. Restart the service and verify the saved account and activity still work. Finally, shut down the local app and open the cloud URL from another device or mobile data, then replace the README's temporary tunnel link with that verified URL.

The server allows the HTTPS origin from Render's `RENDER_EXTERNAL_URL` automatically. For a custom domain, set `FRONTEND_ORIGIN` to the comma-separated HTTPS URLs you use, including the assigned Render URL. Render supplies `PORT`; the service binds to `0.0.0.0`.

Cloud deployment starts with a new database. Existing local accounts and activity are not transferred automatically. If you need those records, stop writes and migrate a consistent SQLite backup to the persistent disk before opening the service to users. Keep a backup of the session signing key if existing sessions must survive migration. Do not upload a live SQLite file without accounting for its WAL, and never commit database files or signing keys.

Keep this service at one instance because it uses SQLite. A persistent disk preserves records across restarts and deployments, but deployments can briefly interrupt service. Free Render web services cannot attach this disk and lose local files on restart or deployment, so switching this configuration to the free plan will not preserve accounts. See [persistent disks](https://render.com/docs/disks) and [free service limits](https://render.com/docs/free).

### Temporary tunnel from your computer

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

Keep real credentials in local environment files or GitHub Actions secrets. The tracked `.env.docker.example` contains placeholders only. Run `npm run check:repo` before committing; CI also checks for private files and common credential formats. Use `npm run check:repo -- --history` to check the locally available Git history. These checks cannot identify every kind of secret, so review the staged diff before pushing and never force-add private files.

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

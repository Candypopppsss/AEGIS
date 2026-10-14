# Development

## Local app

Node.js 24 is required. Install dependencies in the root and `frontend`, then
run `npm run start:api` and `npm run start:web` in separate terminals.
The frontend listens on port 5173 and proxies API requests to port 8080.
SQLite data and the signing key are stored in ignored `local-api/data/`.

To serve the compiled app:

```sh
npm run build
npm run start:production
```

Open `http://localhost:8081`. `PORT` and `DATABASE_PATH` override the defaults.

## Tests

```sh
npm run check:repo
npm run test:repo
npm run test:local
npm run test:cloud
npm run build
npm exec --prefix frontend -- playwright install chromium
```

With the compiled app running on port 8081, run:

```sh
TEST_URL=http://localhost:8081 npm run test:ui
TEST_URL=http://localhost:8081 npm run test:live
```

In PowerShell, set `$env:TEST_URL='http://localhost:8081'` before running either
command. UI tests cover forms, errors, sessions, and mobile layout. Live tests
create a QA account and check sign-in, activity, zones, and saved data.

## Docker

```sh
docker compose up -d --build --wait
```

Open `http://localhost:8081`. Accounts and signing keys persist in the
`local-data` volume. `docker compose down` stops the app without removing data.
Removing that volume deletes local accounts.

`npm run deploy` builds the local containers, runs the live browser test, and
checks that accounts, sessions, and events survive an API restart. This is also
run in GitHub Actions. Docker must be running and Chromium must be installed.
Optional local settings are listed in [`.env.docker.example`](../.env.docker.example).

## Production

[AEGIS](https://aegis-ten-topaz.vercel.app) runs on Vercel. Its free `aegis-db`
Turso database is in Mumbai. It does not depend on a local server.

The root `vercel.json` builds the frontend and deploys `api/index.mjs`.
Configure these Vercel environment variables before deploying:

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | Remote database URL |
| `TURSO_AUTH_TOKEN` | Database access token |
| `SESSION_SECRET` | Stable random signing secret of at least 32 bytes |
| `FRONTEND_ORIGIN` | Optional comma-separated custom HTTPS origins |

See [`.env.vercel.example`](../.env.vercel.example) for placeholders. Keep secrets
in deployment settings. Never put them in Git or frontend variables. Vercel's
assigned origins are allowed automatically.

```sh
vercel --prod
```

Run `npm run test:live` with `TEST_URL` set to the production URL. For a
redeployment persistence check, run `node scripts/test-production.mjs create`,
redeploy, then run `node scripts/test-production.mjs verify` on the same UTC day.
The commands create QA accounts; their credentials stay in ignored `.runtime/`.

Local accounts are not transferred to production. Notification batches are
released on the next dashboard or event request after the zone ends.

## API

Routes use `/api`. Dashboard, activity, and zone routes require a Bearer token.

| Method | Route | Input |
| --- | --- | --- |
| POST | `/auth/register` | `fullName`, `email`, `password`, `timezone` |
| POST | `/auth/login` | `email`, `password` |
| GET | `/dashboard` | Optional `date=YYYY-MM-DD` |
| POST | `/events` | `eventType` |
| POST | `/zones` | `title`, `startsAt`, `endsAt` |
| DELETE | `/zones/{id}` | Zone ID |
| GET | `/health` | None |

Event types are `NOTIFICATION`, `APP_SWITCH`, `MESSAGE_REPLY`, and `FORM_INPUT`.
Zone times are ISO timestamps. Zones cannot overlap, including the 15-minute
preparation period, and can be removed only before preparation starts.

Passwords use scrypt; sessions expire after eight hours. Email verification,
password recovery, and device integrations are not implemented.

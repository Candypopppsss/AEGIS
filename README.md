# AEGIS

[Open the app](https://aegis-ten-topaz.vercel.app)

Track digital activities, review their estimated cost, and schedule focus time.
Built with React, Node.js, and Turso. Hosted on Vercel.

## Repository

| Folder | Contents |
| --- | --- |
| `frontend/` | React pages, styles, and browser tests |
| `backend/` | Node.js API, database client, API tests, and Dockerfile |
| `api/` | Vercel entry point that loads the backend |
| `scripts/` | Build serving and deployment checks |
| `docs/` | Development and deployment instructions |

## Features

- Account creation and sign-in.
- Activity logging: notifications, app switches, replies, and form inputs.
- A daily battery and activity summary.
- Protect zones that batch logged notifications.

The battery starts at 100 points each day in your timezone. Activities cost
1, 2, 3, or 4 points respectively. Protection begins 15 minutes before a zone;
held notifications cost one point when the zone ends.

Activities are entered manually. The app does not monitor other apps or silence
notifications. Battery points are an estimate, not a measure of mental health.

## Development

Requires Node.js 24.

```sh
npm ci
npm ci --prefix frontend
npm run start:api
```

In another terminal:

```sh
npm run start:web
```

Open `http://localhost:5173`. Local accounts use SQLite; production uses Turso.

## Checks

```sh
npm run check:repo
npm run test:repo
npm run test:local
npm run test:cloud
npm run build
```

Browser tests require Chromium and a running app. See the
[development guide](docs/development.md) for browser tests, Docker, deployment,
and API routes.

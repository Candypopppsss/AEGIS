# AEGIS

Small digital decisions add up. AEGIS helps students and professionals see the load from notifications, app switching, replies, and forms, and plan time for work that needs their attention.

**[Open AEGIS](https://outreach-somebody-period-disciplinary.trycloudflare.com)** — use it in your browser; no download needed.

The demo runs in Docker on a personal computer through a Cloudflare Tunnel. It stays available while the computer and internet connection are on. The address can change after the tunnel restarts.

## Using it day to day

1. Create an account and log the digital activities you want to keep track of.
2. Check your decision battery and daily summary to see how those activities add up.
3. Schedule protect zones around study sessions, focused work, or important appointments.

Each day starts with 100 points. Notifications cost 1 point, app switches 2, replies 3, and form inputs 4. During a protect zone, logged notification events are queued and counted as one batch when the zone ends. Protection starts 15 minutes before the scheduled time; the battery resets each day in your timezone.

AEGIS brings decision-load tracking and focus planning into the same daily view. It gives you a way to reflect on how fragmented your day feels, alongside how much you get done.

Activities are logged manually. Protect zones affect the app's records; they do not mute your phone or block other apps. The battery is an estimate based on logged events, not a scientific measurement of mental energy. Message content is not collected.

## Built with

| Part | Technology |
| --- | --- |
| Frontend | React, Vite |
| API and storage | Node.js 24, SQLite |
| Authentication | scrypt password hashing, signed eight-hour sessions |
| Deployment | Docker Compose, Nginx, Cloudflare Tunnel |
| Tests | Node test runner, Playwright, GitHub Actions |

The repository also includes an alternative Spring Boot API with PostgreSQL support.

For setup, tests, deployment, and API routes, see the [development guide](docs/development.md).

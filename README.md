# AEGIS

Small digital decisions add up. AEGIS helps students and professionals see the load from notifications, app switching, replies, and forms, and plan time for work that needs their attention.

**[Open AEGIS](https://aegis-ten-topaz.vercel.app)** — use it in your browser; no download needed.

The app is publicly hosted on Vercel with a connected persistent Turso database and works independently of the development computer. Account creation, sign-in, activity logging, protect zones, and daily summaries are available at the link above.

A free-tier Vercel configuration with a Turso database is included in [`vercel.json`](vercel.json). See the [Vercel setup](docs/development.md#vercel-with-a-free-persistent-database). Production browser and API checks passed on October 14, 2026, including signup, sign-in, all activity types, zones, and saved data after reload and redeployment. Accounts, sessions, activity, battery totals, and scheduled zones survived a fresh production deployment.

## Using it day to day

1. Create an account and log the digital activities you want to keep track of.
2. Check your decision battery and daily summary to see how those activities add up.
3. Schedule protect zones around study sessions, focused work, or important appointments.

Each day starts with 100 points. Notifications cost 1 point, app switches 2, replies 3, and form inputs 4. During a protect zone, logged notification events are queued and counted as one batch when the zone ends. Protection starts 15 minutes before the scheduled time; the battery resets each day in your timezone.

Activities are logged manually. Protect zones affect the app's records; they do not mute your phone or block other apps. The battery is an estimate based on logged events, not a scientific measurement of mental energy. Message content is not collected.

## Built with

| Part | Technology |
| --- | --- |
| Frontend | React 19.2.8, React DOM, JavaScript/JSX, HTML, CSS, Vite 7.3.7 |
| Browser integration | Fetch API for REST/JSON requests; sessionStorage for the session token |
| Primary API | Node.js 24, built-in HTTP server, JavaScript ES modules |
| Local storage | SQLite through Node's built-in `node:sqlite` module |
| Cloud storage | Connected Turso/libSQL database in Mumbai through `@libsql/client` 0.18.0 |
| Node authentication | scrypt password hashing with random salts; HS256 JWTs with eight-hour expiry; Node crypto |
| Public hosting | Vercel static hosting for the frontend and Node serverless functions for the API |
| Local/container hosting | Docker, Docker Compose, Node 24 Alpine, Nginx 1.28; Caddy 2 for optional HTTPS; Cloudflare Tunnel for temporary sharing |
| Tests | Node test runner and assertions, Playwright 1.63.0 with Chromium, API and persistence tests |
| Build and delivery | npm and package lockfiles, Git, GitHub, GitHub Actions |

The repository also includes an **alternative Java backend** in `backend/`: Java 17, Spring Boot 3.5.7, Spring Web/MVC, Spring Data JPA/Hibernate, Bean Validation, Spring Security with its OAuth2 Resource Server/JWT support, BCrypt password hashing, PostgreSQL (PostgreSQL 17 in Compose), H2 for development/tests, Maven, JUnit 5, and Spring Boot Test/MockMvc. This backend is not used by the Vercel deployment.

The Spring backend now also supports **Aiven MySQL** through the `mysql` profile.
Set Vercel's `SPRING_API_URL` to a hosted Spring backend to route the existing
frontend through it. This requires an Aiven database and a separate HTTPS backend
host; see the [Spring + Aiven setup](docs/development.md#spring-boot-with-aiven-mysql).

An optional Render hosting configuration is included in `render.yaml`; it requires a paid hosting account and is not deployed.

For setup, tests, deployment, and API routes, see the [development guide](docs/development.md).

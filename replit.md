# Running on Replit

This project keeps its original npm workspaces: `server` (Express/TypeScript,
SQLite/libsql) and `web` (React/Vite). Do not migrate or restructure it for setup.

## Start

Use Replit's Run button / **Start application** workflow. It runs
`NODE_ENV=development npm run seed && NODE_ENV=development npm run dev`.
Seeding creates the private space if missing;
it does not create demo accounts or overwrite existing data.

- Vite listens on `0.0.0.0:5000` and proxies `/api`, `/media`, and `/socket.io`
  to the API on port 4000.
- The server applies database migrations automatically at startup.
- Without a remote database setting, SQLite lives under `server/data/`.
  Existing `DATABASE_URL` / `DATABASE_AUTH_TOKEN` settings are honored by the
  original server. Uploads remain under `server/data/storage/`, ignored by Git.
- Only run one instance of this workflow at a time.

## Accounts and settings

- Open the preview and create the first account. The existing app allows the
  first person to register without an invitation; claim it before sharing access.
- Invite the second person using the app's invitation controls.
- `INVITE_CODE` is explicitly empty in the Replit environment, disabling the
  repository's publicly documented development bootstrap code.
- `SESSION_SECRET` is supplied through Replit Secrets; never commit it.
- `WEB_ORIGIN` matches the Replit development URL so browser requests and
  realtime connections pass the server's origin checks. Update it if the
  development domain changes.
- SMTP is not configured. Password-reset email requires the existing SMTP
  settings documented in `server/.env.example`; do not invent credentials.

## Checks

Run `npm run typecheck` and `npm run build`.
`/api/health` checks the running API through the preview proxy.
The repository's `server/scripts/verify.ts` expects seeded demo accounts: run
it only against an isolated temporary database/server, not the real private space.

## Publishing

Use **Autoscale** publishing. The `.replit` deployment settings build both
workspaces with `npm run build` during the build phase, then run only the built
server with `npm run start`. Do not build inside the deployment run command:
every cold start would otherwise compile the app while health checks are waiting.

The deployment command sets `NODE_ENV=production`, `PORT=5000`,
`COOKIE_SECURE=1`, and `WEB_ORIGIN=https://diary--rinmico2.replit.app`.
The server listens on `0.0.0.0:5000`; the only external port mapping is
5000 to 80. It serves `web/dist`, `/api`, `/media`, and Socket.IO together.
The API's development port 4000 needs no external mapping because Vite proxies it.
If the public hostname changes, update `WEB_ORIGIN` in the deployment command.

In the Publishing pane, check that the build and run commands match `.replit`
and that production Secrets include the existing `SESSION_SECRET` (at least
32 characters) and any database/SMTP credentials the app uses. Workspace Secrets
and an uncommitted local `.env` are not a substitute for production Secrets.
Keep the existing session secret to preserve current logins.

Pull the latest source into Replit before republishing. The server must include
the static-asset origin exemption in `server/src/app.ts`: older builds reject
browser module/style requests with `403 origin_not_allowed`, blanking the page
even though opening the homepage or an asset without an Origin header works.
Keep `WEB_ORIGIN` set to the public production URL so API writes and realtime
requests also pass origin validation behind Replit's proxy.

After `npm run build`, run `npm run verify:deployment --workspace server`.
This starts a separate production server with a temporary database and checks
the homepage, built assets, deep links, proxy origin handling, realtime
handshake, and authentication boundaries without touching the real space.

Configure durable storage for the existing SQLite database and uploaded files
before relying on a published deployment for private data. Published local files
do not persist across republishes. Preserve the existing database technology
unless the user explicitly requests a change.

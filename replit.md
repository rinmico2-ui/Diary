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

This setup is for development preview, not a production data-storage setup.
Before publishing, configure durable storage for the existing SQLite database
and uploaded files, the production origin, secure cookies, and secrets. Preserve
the existing database technology unless the user explicitly requests a change.

# Our Little Space ❤️

A private two-person world: chat, diary, photo album, collections, and a shared
timeline — for exactly two people and nobody else.

The database is real and persistent. The privacy is enforced on the server, not
by hiding buttons in the interface.

---

## Quick start

```bash
npm install

cd server
cp .env.example .env
npm run db:migrate        # creates server/data/our-space.db
npm run seed -- --people  # creates the space + two accounts
npm run seed:demo         # optional: fills it with demo memories
cd ..

npm run dev               # API on :4000, web client on :5173
```

Open <http://localhost:5173>.

> **Only run one copy at a time.** A second `npm run dev` will fail with
> `EADDRINUSE` because port 4000 is taken, and Vite will quietly move to 5174 —
> which means you'd be looking at a client pointed at a stale session. If you
> lose track of a running instance, `npm run stop` shuts down every process
> belonging to this project (and nothing else).

The seed prints the two demo logins (both use `ourlittle2026`):

| Account | Email |
| --- | --- |
| You | `you@ourlittlespace.app` |
| Her | `her@ourlittlespace.app` |

**Change these before going anywhere near the internet.** Add your own `.env`
values first: `SESSION_SECRET` and `INVITE_CODE` must both be changed.

### Verifying it works

```bash
npm run verify --workspace server
```

75 checks against a running server, covering the privacy boundary, messaging,
uploads, search, timeline and validation. It creates and cleans up its own
records, so it is safe to re-run.

---

## What it does

**Home** — a warm dashboard: recent messages, photos and diary, favourites,
collections, plus one-tap access to the four things you actually do.

**Messages** — one private conversation. Text, photos, voice notes, emoji
reactions, replies, edits, deletes, read receipts, typing indicators, presence,
date separators, message grouping, and sharing any memory into the chat as a
tappable card.

**Diary** — entries with a title, date, mood, tags, photos, a collection, and a
choice that matters: **🔒 Only me** or **❤️ Both of us**. The server enforces
that choice; a private entry is never returned to the other person, not in a
list, not in search, not in a collection's statistics, and not through a shared
chat card.

**Memories** — a responsive photo grid (2 columns on mobile, up to 6 on
desktop), a fullscreen viewer with keyboard and swipe navigation, and per-photo
caption, description, date, tags, collection, favourite state and owner.

**Collections** — memory folders with a cover, description and counts. Deleting
one **never** deletes what is inside it; photos and entries simply become
unfiled and stay in your library. The app tells you exactly how many were kept.

**Timeline** — every day, in order, grouping photos, diary entries and messages
under a month heading.

**Favorites** — favourite photos, diary entries and messages in one feed.

**Search** — messages, diary, photos, collections and tags, with `/` as a
keyboard shortcut.

---

## How privacy actually works

The chain on every single request:

```
session cookie  →  valid user  →  member of this space  →  owns / may read this resource
```

Concretely:

- **Sessions** are opaque 256-bit random tokens. Only an HMAC-SHA256 digest
  (keyed with `SESSION_SECRET`) is stored, in an `httpOnly` cookie, so
  JavaScript cannot read it and a leaked database dump cannot be replayed as
  cookies. `SameSite=Lax`, `Secure` in production. Not a JWT — those cannot be
  revoked, and logout here genuinely revokes.
- **Passwords** use scrypt (N=32768, r=8, p=1, 32 MB) with a per-user salt.
  A failed login still runs a full hash comparison so a missing account and a
  wrong password take the same time.
- **Registration is closed.** You need `INVITE_CODE`, and the space refuses a
  third member with `409`. There is no way to add anyone else.
- **Every query is space-scoped.** Visibility lives in the SQL `WHERE` clause,
  not in post-filtering, so there is no code path that returns a private entry
  to the wrong person.
- **Media is authenticated too.** `/media/*` requires a valid session *and* that
  the object is referenced by a resource in your space. Guessing a URL gets
  nothing.
- **Uploads are validated by content.** The real format is sniffed by decoding
  the bytes with sharp; a `.jpg` containing a script is rejected. Images are
  re-encoded to WebP with EXIF auto-rotation and a generated thumbnail.
- **Rate limiting** is per-account when signed in, per-IP otherwise, so two
  people on one connection never lock each other out.
- **All input is schema-validated** with zod, and diary HTML is restricted to a
  safe formatting subset (no scripts, no event handlers, no iframes).

> Hiding the "delete" button is not a security control, so nothing here relies
> on it. `npm run verify` proves it by attempting cross-account reads and writes
> directly against the API.

---

## Architecture

```
server/                      Express + Socket.IO API
  src/db/schema.sql          the whole relational model
  src/db/index.ts            prepared-statement data layer (node:sqlite, WAL)
  src/lib/                   password hashing, sessions, storage, image pipeline
  src/middleware/            auth, validation, rate limits, error handling
  src/services/              the actual rules (space, diary, photos, messages…)
  src/realtime/              Socket.IO hub + authenticated handshake
  src/routes/                HTTP surface
  scripts/                   seed, seed:demo, verify, inspect-ui

web/                         Vite + React + TypeScript + Tailwind
  src/lib/                   API client, session, socket, hooks, formatting
  src/components/            design system, sheets, photo grid, chat thread
  src/pages/                 one file per surface
```

**Database** — SQLite via Node 24's built-in `node:sqlite`, in WAL mode with
foreign keys on. No native compilation, no external service, and genuinely
persistent. Tables follow the specified model: `users`, `private_spaces`,
`space_members`, `messages`, `message_reads`, `message_reactions`,
`diary_entries`, `photos`, `collections`, `tags`, `memory_tags`,
`attachments`, `notifications`, `sessions`, `user_settings`.

**Image binaries never go in the database.** They are written through an
`ObjectStore` interface (local disk today, swappable for S3/R2 without touching
a route), and only URLs are stored.

**Realtime** — Socket.IO authenticates the handshake with the same session
cookie as the REST API, so a socket can never be opened by someone who could not
call the API anyway. Rooms are per user and per space. Delivers new messages,
edits, deletes, reactions, read receipts, typing, presence, and memory changes.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web client together |
| `npm run stop` | Stop a dev stack left running in another terminal |
| `npm run build` | Compile the server, then bundle the client |
| `npm run start` | Run the built server |
| `npm run typecheck` | Typecheck both packages |
| `npm run db:migrate --workspace server` | Create/upgrade the schema |
| `npm run seed --workspace server -- --people` | Create the space and two accounts |
| `npm run seed:demo --workspace server` | Fill the space with demo memories |
| `npm run seed:demo --workspace server -- --reset` | Wipe demo content and regenerate |
| `npm run verify --workspace server` | 75-check end-to-end suite |

---

## Deploying

1. Set `NODE_ENV=production` and a real `SESSION_SECRET` (32+ chars).
2. Set your own `INVITE_CODE` and `SPACE_NAME`; set `COOKIE_SECURE=1` behind HTTPS.
3. `npm run build`, then `npm run start`.
4. Put a TLS-terminating reverse proxy in front and forward both HTTP and
   WebSocket upgrades.
5. Back up `server/data/` — that directory is the entire application state.

---

## Notes and limits

- Registration is invite-only and the space is capped at two members, by design.
- Local disk storage is fine for two people. For larger scale, implement
  `ObjectStore` against S3 or R2 — the interface is four methods.
- Rich text is a deliberately small formatting subset (bold, italic, headings,
  lists, quotes) rendered as escaped, validated HTML. It is not a full
  WYSIWYG editor.
- Voice notes depend on `MediaRecorder`; where a browser does not support it the
  record button is hidden rather than failing.
- The database layer is deliberately concentrated in `src/db/index.ts` and the
  service modules, so moving to Postgres is a contained change rather than a
  rewrite.

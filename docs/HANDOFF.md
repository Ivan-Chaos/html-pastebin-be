# Handoff: snippets-api

## What this is
The backend for **Shareable HTML Snippets**. Users create HTML snippets (name, HTML content, author, timestamp) and get a shareable link to each one. This service owns the data: it is the **only** component that touches the SQLite database. The frontend lives in a separate repo, `snippets-web` (Next.js), and talks to this API over HTTP.

Data must persist across restarts and redeploys.

## Stack (fixed, don't substitute)
- Node 20+, Express 5, TypeScript
- `better-sqlite3`: no ORM, prepared statements only
- `cors`
- Dev: `tsx watch`; Prod: `tsc` → `node dist/index.js`

## Hard rules
- **Only this service touches SQLite.** Nothing else imports a DB library.
- **Prepared statements with `?` params only.** Never build SQL by string concatenation.
- **Random share IDs.** Use a random 10-char base64url ID (from `crypto.randomBytes`), never a sequential ID, so snippets can't be enumerated.
- **Locked-down CORS.** Allow only the web app's origin, read from `CORS_ORIGIN`. Never `*`.
- **No auth in scope.** `author` is a plain-text name the user types.
- **Persistent storage.** In production `DB_PATH` must point at a persistent disk or volume. Hosts with an ephemeral filesystem (many free tiers) wipe the DB on restart.
- The API stores HTML as-is. Rendering safety (a sandboxed iframe) is the frontend's job, so don't sanitize or alter content here.

## Data model: table `snippets`
| Field | Type | Notes |
| --- | --- | --- |
| id | TEXT PK | random 10-char base64url, used in the share URL |
| name | TEXT NOT NULL | required, trimmed, max 200 chars |
| content | TEXT NOT NULL | required, raw HTML, max 100 KB |
| author | TEXT NOT NULL | required, trimmed, max 100 chars |
| created_at | TEXT NOT NULL | ISO 8601 UTC, set by the DB default (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`) |

- Index on `(created_at DESC, id DESC)` for the paginated gallery (`id` breaks ties so the order is stable).
- Create the schema on startup with `CREATE TABLE IF NOT EXISTS`, so there's no separate migration step.
- Enable WAL mode (`journal_mode = WAL`).
- Create the parent directory of `DB_PATH` on startup if it doesn't exist.

## API routes
| Route | Behaviour |
| --- | --- |
| `GET /health` | `{ ok: true }` |
| `POST /snippets` | Validates the body, then inserts the snippet. Returns 201 with the full snippet, including `id` and `created_at`. Returns 400 `{ error }` on validation failure. |
| `GET /snippets?page=1&pageSize=20` | Paginated gallery, newest first. Returns `{ items, page, pageSize, total, totalPages }`; `items` are metadata only (`id, name, author, created_at`), without `content`. `page` defaults to 1 and must be ≥ 1. `pageSize` defaults to 20 and must be between 1 and 50. Any other value returns 400. A page past the end returns `items: []`. |
| `GET /snippets/:id` | Returns the full snippet, or 404 `{ error: 'Not found' }`. |

- Validation: each field must be a non-empty string after trimming and within its max length.
- Body limit: `express.json({ limit: '200kb' })`. Larger requests get a 413.
- A final error handler logs the error and returns 500 `{ error: 'Internal error' }`, so stack traces never leak.

## Environment variables
| Var | Example | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | listen port |
| `DB_PATH` | `./data/snippets.db` | SQLite file location (must be on a persistent volume in prod) |
| `CORS_ORIGIN` | `http://localhost:3000` | exact web origin: scheme, host and port, no trailing slash |

See `.env.example`.

## Current status
**Done:** scaffold, `src/db.ts` (WAL, schema and index, prepared statements), all snippet routes with validation, paginated gallery, and the error handler (413 for oversized bodies, 400 for malformed JSON, otherwise 500 `{ error: 'Internal error' }`). Smoke-tested end to end, including persistence across restarts.

**Next:** wire up `snippets-web` to the paginated `GET /snippets` response, then deploy.

## Deploy
- Use a host with a **persistent volume**. Set `DB_PATH=/<volume-mount>/snippets.db`, `PORT`, and `CORS_ORIGIN=https://<web-domain>`.
- `better-sqlite3` is a native module, so the host must run `npm install` itself. Never copy `node_modules` from another machine.
- Run `npm run build`, then `npm start`.

## Verify (prod)
- `GET https://<api-domain>/health` returns `{ ok: true }`.
- Create a snippet, restart or redeploy, and confirm it is still there. That proves the volume is persistent.

## Troubleshooting
- Browser CORS error: `CORS_ORIGIN` doesn't exactly match the web origin.
- Data gone after redeploy: `DB_PATH` isn't on a persistent volume.
- `invalid ELF header` / `NODE_MODULE_VERSION`: `node_modules` was built on another OS or Node version. Reinstall on the host.
- `req.body` undefined: the client didn't send `Content-Type: application/json`.
- 413: the request is over the 200 KB limit.

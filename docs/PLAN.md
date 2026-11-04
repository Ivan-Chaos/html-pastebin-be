# Plan: snippets-api endpoints (create, view, paginated gallery)

## Context
`docs/HANDOFF.md` describes an Express 5 + better-sqlite3 backend for an HTML pastebin. Scaffold is done (`src/index.ts` has CORS, 200kb JSON limit, `/health`). Missing: DB layer, snippet routes, validation, error handler. One deviation from the handoff, chosen by the user: the gallery (`GET /snippets`) is **page-number paginated** instead of "50 most recent".

## Endpoints
| Route | Behaviour |
| --- | --- |
| `GET /health` | `{ ok: true }` (exists) |
| `POST /snippets` | body `{ name, content, author }` → validate → insert → **201** full snippet `{ id, name, content, author, created_at }`; **400** `{ error }` on bad input |
| `GET /snippets/:id` | full snippet, or **404** `{ error: 'Not found' }` |
| `GET /snippets?page=1&pageSize=20` | **200** `{ items, page, pageSize, total, totalPages }`; items are metadata only (`id, name, author, created_at`), newest first |

Pagination rules: `page` default 1, integer ≥ 1; `pageSize` default 20, integer 1–50. Non-integer / out-of-range → 400 `{ error }`. A page past the end returns `items: []` (not 404). `totalPages = ceil(total / pageSize)`.

## Files

### New: `src/db.ts`
- Read `DB_PATH` (default `./data/snippets.db`); `fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })`.
- `new Database(DB_PATH)`, `db.pragma('journal_mode = WAL')`.
- `CREATE TABLE IF NOT EXISTS snippets (id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`.
- `CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets (created_at DESC, id DESC)` (id as tiebreaker for deterministic ordering).
- Prepared statements (all `?` params):
  - insert: `INSERT INTO snippets (id, name, content, author) VALUES (?, ?, ?, ?) RETURNING *`
  - getById: `SELECT id, name, content, author, created_at FROM snippets WHERE id = ?`
  - listPage: `SELECT id, name, author, created_at FROM snippets ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  - count: `SELECT COUNT(*) AS total FROM snippets`
- Export typed functions: `createSnippet`, `getSnippet`, `listSnippets(page, pageSize)` (count + page in one `db.transaction` for a consistent snapshot).
- `newId()`: `crypto.randomBytes(8).toString('base64url').slice(0, 10)`; on the (astronomically unlikely) PK collision `SQLITE_CONSTRAINT_PRIMARYKEY`, retry a few times.

### Edit: `src/index.ts`
- Validation helper: field must be `typeof === 'string'`, non-empty after trim, within max (name 200, author 100 after trim; content ≤ 100 KB by `Buffer.byteLength`, **not trimmed/altered**, stored as-is). Reject non-object body (`req.body` undefined when no JSON content-type) with 400.
- Routes as above. Express 5 forwards async/thrown errors automatically.
- Final error handler `(err, req, res, next)`: pass through 413 / 400 JSON-parse errors from `express.json` (`err.status`/`err.type`) as `{ error }`; otherwise `console.error(err)` and 500 `{ error: 'Internal error' }`.
- Keep `cors({ origin: CORS_ORIGIN })`, never `*`.

### Edit: `docs/HANDOFF.md`
Update the `GET /snippets` row to the paginated contract so the frontend team (`snippets-web`) sees the new shape; tick off "To do" items.

### Optional: `package.json`
`dev` script → `tsx watch --env-file=.env src/index.ts` so `.env` is loaded locally (no new dependency; Node 20.6+ supports it). Prod reads real env vars.

## Verification
1. `npm run build` passes.
2. `npm run dev`, then with curl:
   - `POST /snippets` valid body → 201, 10-char id, ISO `created_at`.
   - Missing/blank/oversized field → 400; >200 KB body → 413; malformed JSON → 400.
   - `GET /snippets/<id>` → content byte-identical to what was posted; unknown id → 404.
   - Create ~25 snippets; `GET /snippets?pageSize=10&page=3` → 5 items, `total` 25, `totalPages` 3; `page=0` / `pageSize=999` → 400; `page=10` → empty items.
   - Request with `Origin: http://evil.example` → no `Access-Control-Allow-Origin` header.
3. Restart server → snippets still present (DB file in `./data`, WAL files alongside).

# snippets-api: API reference

The HTTP API for **Shareable HTML Snippets**, for the `snippets-web` frontend.

- **Base URL (dev):** `http://localhost:4000`
- **Format:** JSON. Send `Content-Type: application/json` on every request with a body.
- **CORS:** only the origin in the API's `CORS_ORIGIN` env var is allowed (dev: `http://localhost:3000`).
- **Errors:** every error response is `{ "error": string }` with a suitable status code.

## Types

```ts
type Snippet = {
  id: string;         // random 10-char base64url, used in the share URL
  name: string;       // 1–200 chars, trimmed
  content: string;    // raw HTML, up to 100 KB, stored exactly as sent
  author: string;     // 1–100 chars, trimmed; "Anonymous" if none was given
  created_at: string; // ISO 8601 UTC, e.g. "2026-11-04T09:43:49.933Z"
};

type SnippetMeta = Omit<Snippet, 'content'>;

type SnippetPage = {
  items: SnippetMeta[]; // newest first
  page: number;
  pageSize: number;
  total: number;        // total snippets
  totalPages: number;   // ceil(total / pageSize); 0 when there are none
};

type ApiError = { error: string };
```

## Endpoints

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| GET | `/health` | none | 200 `{ ok: true }` |
| POST | `/snippets` | none | 201 `Snippet` |
| GET | `/snippets?page=&pageSize=` | none | 200 `SnippetPage` |
| GET | `/snippets/:id` | none | 200 `Snippet` |
| PATCH | `/snippets/:id` | admin | 200 `Snippet` |
| DELETE | `/snippets/:id` | admin | 204 (no body) |

### POST /snippets: create a snippet

Request body:

| Field | Required | Rules |
| --- | --- | --- |
| `name` | yes | string, non-empty after trimming, max 200 chars |
| `content` | yes | string, not just whitespace, max 100 KB (UTF-8). HTML is **not** validated or sanitized |
| `author` | no | string, max 100 chars. Missing, `null` or blank is stored as `"Anonymous"` |

```http
POST /snippets
Content-Type: application/json

{ "name": "Hello", "content": "<h1>Hi</h1>", "author": "Ivan" }
```

```json
201
{ "id": "yzdZX8rF7A", "name": "Hello", "content": "<h1>Hi</h1>", "author": "Ivan", "created_at": "2026-11-04T09:43:49.933Z" }
```

Errors: `400` for invalid fields, a body that isn't JSON, or malformed JSON. `413` if the request body is over 200 KB.

### GET /snippets: gallery (paginated)

| Query | Default | Rules |
| --- | --- | --- |
| `page` | `1` | integer ≥ 1 |
| `pageSize` | `20` | integer 1–50 |

```json
GET /snippets?page=2&pageSize=10
200
{
  "items": [{ "id": "Z5dEpvVRvd", "name": "s5", "author": "a", "created_at": "2026-11-04T09:43:50.808Z" }],
  "page": 2, "pageSize": 10, "total": 25, "totalPages": 3
}
```

- Items leave out `content`. Fetch `/snippets/:id` to render one.
- A page past the end returns `items: []` with status 200, not 404.
- A bad `page` or `pageSize` returns `400`.
- Pages are counted from the newest snippet. A snippet created while someone is browsing pushes everything down by one, so the next page can repeat an item.

### GET /snippets/:id: view a snippet

Returns `200 Snippet`, or `404 { "error": "Not found" }`.

**Rendering:** `content` is untrusted user HTML. Always render it in a sandboxed iframe, e.g. `<iframe sandbox srcdoc={content}>`. Don't inject it into the page DOM.

### PATCH /snippets/:id: edit a snippet (admin)

Send any of `name`, `content`, `author` (at least one). The rules are the same as create. Fields you leave out stay unchanged. Sending `author` as `""` or `null` resets it to `"Anonymous"`.

```http
PATCH /snippets/yzdZX8rF7A
Authorization: Bearer <ADMIN_KEY>
Content-Type: application/json

{ "name": "Renamed" }
```

Returns `200 Snippet`. Errors: `401` for a missing or wrong key, `400` for invalid input, `404` for an unknown id.

### DELETE /snippets/:id: delete a snippet (admin)

```http
DELETE /snippets/yzdZX8rF7A
Authorization: Bearer <ADMIN_KEY>
```

Returns `204`. Errors: `401` for a missing or wrong key, `404` for an unknown id.

## Admin key

- Send it as `Authorization: Bearer <ADMIN_KEY>`. A query-string key is not accepted.
- **Never ship it to the browser.** Don't put it in a `NEXT_PUBLIC_*` variable. Call PATCH and DELETE from server-side code in `snippets-web` (a route handler or server action) that reads the key from a server-only env var.
- If the API's `ADMIN_KEY` is unset, PATCH and DELETE always return `401`.

## Status codes

| Code | Meaning |
| --- | --- |
| 200 / 201 / 204 | success |
| 400 | validation failed, malformed JSON, or the body isn't a JSON object |
| 401 | admin key missing or wrong (PATCH/DELETE only) |
| 404 | snippet or route not found |
| 413 | request body over 200 KB |
| 500 | `{ "error": "Internal error" }`; details are only in the server log |

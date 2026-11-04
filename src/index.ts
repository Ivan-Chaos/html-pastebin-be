import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import {
  createSnippet,
  deleteSnippet,
  getSnippet,
  listSnippets,
  updateSnippet,
  type SnippetPatch,
} from './db';

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY?.trim() || undefined;

if (!ADMIN_KEY) {
  console.warn('ADMIN_KEY is not set: edit/delete endpoints will reject every request.');
} else if (ADMIN_KEY.length < 32) {
  console.warn('ADMIN_KEY is shorter than 32 characters; use a long random value.');
}

const LIMITS = { name: 200, author: 100, contentBytes: 100 * 1024 };
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '200kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

type Field = 'name' | 'content' | 'author';
const FIELDS: readonly Field[] = ['name', 'content', 'author'];
type Validated<T> = { value: T } | { error: string };

const DEFAULT_AUTHOR = 'Anonymous';

/** Validates one field; returns the normalized value to store. */
function validateField(field: Field, raw: unknown): Validated<string> {
  if (field === 'author') {
    // Optional: missing, null or blank becomes "Anonymous".
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
      return { value: DEFAULT_AUTHOR };
    }
    if (typeof raw !== 'string') return { error: 'author must be a string' };
  }
  if (typeof raw !== 'string' || !raw.trim()) return { error: `${field} is required` };
  if (field === 'content') {
    // Content is stored as-is (no trimming/sanitizing); the frontend renders it sandboxed.
    if (Buffer.byteLength(raw, 'utf8') > LIMITS.contentBytes) return { error: 'content must be at most 100 KB' };
    return { value: raw };
  }
  const value = raw.trim();
  if (value.length > LIMITS[field]) return { error: `${field} must be at most ${LIMITS[field]} characters` };
  return { value };
}

/**
 * Validates a request body. With `partial`, absent fields are skipped (but at
 * least one must be present); otherwise every field is required.
 */
function validateSnippetBody(body: unknown, partial: boolean): Validated<SnippetPatch> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object (send Content-Type: application/json)' };
  }
  const input = body as Record<string, unknown>;
  const out: SnippetPatch = {};
  for (const field of FIELDS) {
    if (partial && input[field] === undefined) continue;
    const result = validateField(field, input[field]);
    if ('error' in result) return result;
    out[field] = result.value;
  }
  if (Object.keys(out).length === 0) return { error: 'Provide at least one of: name, content, author' };
  return { value: out };
}

// Hash both sides so timingSafeEqual gets equal-length buffers and the
// comparison time doesn't leak the key's length or contents.
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();
const ADMIN_KEY_HASH = ADMIN_KEY ? sha256(ADMIN_KEY) : null;

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
  if (!ADMIN_KEY_HASH || !match || !crypto.timingSafeEqual(sha256(match[1]), ADMIN_KEY_HASH)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function parseIntParam(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

app.post('/snippets', (req, res) => {
  const result = validateSnippetBody(req.body, false);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(createSnippet(result.value as Required<SnippetPatch>));
});

app.get('/snippets', (req, res) => {
  const page = parseIntParam(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  if (page === null) {
    res.status(400).json({ error: 'page must be an integer >= 1' });
    return;
  }
  const pageSize = parseIntParam(req.query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  if (pageSize === null) {
    res.status(400).json({ error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}` });
    return;
  }
  res.json(listSnippets(page, pageSize));
});

app.get('/snippets/:id', (req, res) => {
  const snippet = getSnippet(req.params.id);
  if (!snippet) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(snippet);
});

app.patch('/snippets/:id', requireAdmin, (req: Request<{ id: string }>, res: Response) => {
  const result = validateSnippetBody(req.body, true);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const snippet = updateSnippet(req.params.id, result.value);
  if (!snippet) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(snippet);
});

app.delete('/snippets/:id', requireAdmin, (req: Request<{ id: string }>, res: Response) => {
  if (!deleteSnippet(req.params.id)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).end();
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { status?: number; type?: string };
  if (e.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large (max 200 KB)' });
    return;
  }
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));

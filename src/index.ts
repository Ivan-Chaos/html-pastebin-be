import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createSnippet, getSnippet, listSnippets } from './db';

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

const LIMITS = { name: 200, author: 100, contentBytes: 100 * 1024 };
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '200kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

type CreateInput = { name: string; content: string; author: string };

function validateCreate(body: unknown): { value: CreateInput } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object (send Content-Type: application/json)' };
  }
  const { name, content, author } = body as Record<string, unknown>;

  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (name.trim().length > LIMITS.name) return { error: `name must be at most ${LIMITS.name} characters` };

  if (typeof author !== 'string' || !author.trim()) return { error: 'author is required' };
  if (author.trim().length > LIMITS.author) return { error: `author must be at most ${LIMITS.author} characters` };

  // Content is stored as-is (no trimming/sanitizing); the frontend renders it sandboxed.
  if (typeof content !== 'string' || !content.trim()) return { error: 'content is required' };
  if (Buffer.byteLength(content, 'utf8') > LIMITS.contentBytes) return { error: 'content must be at most 100 KB' };

  return { value: { name: name.trim(), author: author.trim(), content } };
}

function parseIntParam(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

app.post('/snippets', (req, res) => {
  const result = validateCreate(req.body);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(createSnippet(result.value));
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

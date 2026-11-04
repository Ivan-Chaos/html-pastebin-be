import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Snippet {
  id: string;
  name: string;
  content: string;
  author: string;
  created_at: string;
}

export type SnippetMeta = Omit<Snippet, 'content'>;

const DB_PATH = process.env.DB_PATH ?? './data/snippets.db';

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS snippets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,
    author     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_snippets_created_at
    ON snippets (created_at DESC, id DESC);
`);

const insertStmt = db.prepare<[string, string, string, string], Snippet>(
  `INSERT INTO snippets (id, name, content, author) VALUES (?, ?, ?, ?)
   RETURNING id, name, content, author, created_at`,
);
const getByIdStmt = db.prepare<[string], Snippet>(
  `SELECT id, name, content, author, created_at FROM snippets WHERE id = ?`,
);
const listPageStmt = db.prepare<[number, number], SnippetMeta>(
  `SELECT id, name, author, created_at FROM snippets
   ORDER BY created_at DESC, id DESC
   LIMIT ? OFFSET ?`,
);
const countStmt = db.prepare<[], { total: number }>(
  `SELECT COUNT(*) AS total FROM snippets`,
);
// NULL params leave the column unchanged, so one statement handles any partial update.
const updateStmt = db.prepare<[string | null, string | null, string | null, string], Snippet>(
  `UPDATE snippets
   SET name = COALESCE(?, name), content = COALESCE(?, content), author = COALESCE(?, author)
   WHERE id = ?
   RETURNING id, name, content, author, created_at`,
);
const deleteStmt = db.prepare<[string]>(`DELETE FROM snippets WHERE id = ?`);

function newId(): string {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

export function createSnippet(input: { name: string; content: string; author: string }): Snippet {
  for (let attempt = 0; ; attempt++) {
    try {
      return insertStmt.get(newId(), input.name, input.content, input.author)!;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' && attempt < 4) continue;
      throw err;
    }
  }
}

export function getSnippet(id: string): Snippet | undefined {
  return getByIdStmt.get(id);
}

export const listSnippets = db.transaction((page: number, pageSize: number) => {
  const { total } = countStmt.get()!;
  const items = listPageStmt.all(pageSize, (page - 1) * pageSize);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
});

export type SnippetPatch = Partial<Pick<Snippet, 'name' | 'content' | 'author'>>;

export function updateSnippet(id: string, patch: SnippetPatch): Snippet | undefined {
  return updateStmt.get(patch.name ?? null, patch.content ?? null, patch.author ?? null, id);
}

/** Returns true if a snippet was deleted. */
export function deleteSnippet(id: string): boolean {
  return deleteStmt.run(id).changes > 0;
}

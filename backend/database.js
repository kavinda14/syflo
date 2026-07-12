const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In production (Tauri-bundled app), the backend folder is read-only inside
// the .app bundle. The Tauri Rust wrapper sets FLOWTALK_DATA_DIR to a
// per-user writable location (e.g. ~/Library/Application Support/app.flowtalk).
// In normal development (running `npm start` from backend/), no env var is
// set and we fall back to the backend folder for backwards compatibility.
const DATA_DIR = process.env.FLOWTALK_DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'flowtalk.db');

function createDb(dbPath = DB_PATH) {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      parent_id TEXT,
      parent_word TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES chats(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

    -- Globale Settings als Key-Value-Store. Aktuelle Keys:
    --   llm_provider:      'ollama' | 'openai'
    --   openai_api_key:    raw secret (nur intern, wird nie ans Frontend geschickt)
    --   openai_model:      z. B. 'gpt-4o' oder 'gpt-4o-mini'
    --   ollama_model:      z. B. 'llama3.2-vision:11b'
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Papers: PDF, das an einen Chat tree gebunden ist (ADR-0002: max. eins
    -- pro Tree, der Root-Chat trägt paper_id). Minimaler Syflo-Port ohne
    -- Marker-Pipeline — status ist direkt 'ready', 'parsing'/'failed' bleiben
    -- im CHECK für Schema-Kompatibilität mit Syflo.
    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      title TEXT,
      authors_json TEXT,
      uploaded_at TEXT NOT NULL,
      pdf_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('parsing', 'ready', 'failed'))
    );
  `);

  // Migration: chats.paper_id (nullable) — der Root-Chat eines Trees ist an
  // ein Paper gebunden. Idempotent: PRAGMA-Check vor ALTER (wie in Syflo).
  const chatsCols = db.prepare('PRAGMA table_info(chats)').all();
  if (!chatsCols.some((c) => c.name === 'paper_id')) {
    db.exec('ALTER TABLE chats ADD COLUMN paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL');
  }

  return db;
}

module.exports = { createDb, DB_PATH };

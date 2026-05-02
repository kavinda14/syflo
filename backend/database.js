const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'flowtalk.db');

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
  `);

  return db;
}

module.exports = { createDb, DB_PATH };

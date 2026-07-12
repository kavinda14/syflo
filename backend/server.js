require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./database');

// Same FLOWTALK_DATA_DIR convention as database.js: in the Tauri bundle this
// points to a writable per-user location; in dev (no env var) we fall back to
// the project's uploads/ folder so existing data keeps working.
const DATA_DIR = process.env.FLOWTALK_DATA_DIR || path.join(__dirname, '..');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Hochgeladene Dateien für das Frontend bereitstellen
  // (Bilder/Dokumente in alten Nachrichten anzeigen)
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.use('/api/chats', require('./routes/chats')(db));
  app.use('/api/chats/:chatId/messages', require('./routes/messages')(db, UPLOADS_DIR));
  app.use('/api/explain', require('./routes/explain')(db));
  app.use('/api/papers', require('./routes/papers')(db, UPLOADS_DIR));
  // Highlights + Labels: Pfade wie /api/papers/:id/highlights und
  // /api/highlight-labels leben in einem Router, daher Mount auf /api.
  app.use('/api', require('./routes/highlights')(db));
  app.use('/api/settings', require('./routes/settings')(db));
  app.use('/api/search', require('./routes/search')());

  app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

if (require.main === module) {
  const db = createDb();
  const app = createApp(db);
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`FlowTalk backend running on http://localhost:${PORT}`);
  });
}

module.exports = { createApp };

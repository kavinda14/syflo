require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./database');

// Same SYFLO_DATA_DIR convention as database.js: in the Tauri bundle this
// points to a writable per-user location; in dev (no env var) we fall back to
// the project's uploads/ folder so existing data keeps working.
const DATA_DIR = process.env.SYFLO_DATA_DIR || path.join(__dirname, '..');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function createApp(db, options = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Hochgeladene Dateien für das Frontend bereitstellen
  // (Bilder/Dokumente in alten Nachrichten anzeigen)
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.use('/api/chats', require('./routes/chats')(db));
  // options.messages: z. B. { extractPdfTextFn } — injizierbar für Tests.
  app.use('/api/chats/:chatId/messages', require('./routes/messages')(db, UPLOADS_DIR, options.messages));
  app.use('/api/explain', require('./routes/explain')(db));
  app.use('/api/papers', require('./routes/papers')(db, UPLOADS_DIR));
  // Highlights + Labels: Pfade wie /api/papers/:id/highlights und
  // /api/highlight-labels leben in einem Router, daher Mount auf /api.
  app.use('/api', require('./routes/highlights')(db));
  // Chat-Text-Highlights: /api/chats/:id/message-highlights und
  // /api/message-highlights/:id teilen sich einen Router → Mount auf /api.
  app.use('/api', require('./routes/message-highlights')(db));
  // Baum-weite Highlight-Übersicht für den Highlights-Drawer:
  // /api/chats/:id/tree-highlights → Mount auf /api.
  app.use('/api', require('./routes/tree-highlights')(db));
  app.use('/api/settings', require('./routes/settings')(db, { system: options.system }));
  // options.transcribe: { manager } — injizierbar für Tests (Fake-Whisper).
  app.use('/api/transcribe', require('./routes/transcribe')(options.transcribe));
  app.use('/api/search', require('./routes/search')());
  // options.system: { totalmem, platform } — injizierbar für Tests.
  app.use('/api/system', require('./routes/system')(options.system));

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
    console.log(`Syflo backend running on http://localhost:${PORT}`);
  });
}

module.exports = { createApp };

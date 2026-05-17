require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./database');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
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
  app.use('/api/settings', require('./routes/settings')(db));

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

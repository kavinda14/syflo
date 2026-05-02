require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createDb } = require('./database');

function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/chats', require('./routes/chats')(db));
  app.use('/api/chats/:chatId/messages', require('./routes/messages')(db));
  app.use('/api/explain', require('./routes/explain')());

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

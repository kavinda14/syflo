const express = require('express');

module.exports = (db) => {
  const router = express.Router();
  // Get all root chats (no parent)
  router.get('/', (req, res) => {
    const chats = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM chats child WHERE child.parent_id = c.id) as child_count
      FROM chats c
      ORDER BY c.created_at DESC
    `).all();
    res.json(chats);
  });

  // Get full chat tree.
  // Each node carries a `preview` (first user message, truncated) and
  // `message_count` so the mindmap can show what each chat is actually about
  // instead of just titles.
  router.get('/tree', (req, res) => {
    const all = db.prepare(`
      SELECT c.*,
        (SELECT m.content
           FROM messages m
          WHERE m.chat_id = c.id AND m.role = 'user'
          ORDER BY m.created_at ASC
          LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
      FROM chats c
      ORDER BY c.created_at ASC
    `).all();

    const PREVIEW_LIMIT = 140;
    const map = {};
    all.forEach(c => {
      const preview = c.preview
        ? (c.preview.length > PREVIEW_LIMIT
            ? c.preview.slice(0, PREVIEW_LIMIT).trimEnd() + '…'
            : c.preview)
        : null;
      map[c.id] = { ...c, preview, children: [] };
    });
    const roots = [];
    all.forEach(c => {
      if (c.parent_id && map[c.parent_id]) {
        map[c.parent_id].children.push(map[c.id]);
      } else {
        roots.push(map[c.id]);
      }
    });
    res.json(roots);
  });

  // Get single chat with messages (and attachments per message)
  router.get('/:id', (req, res) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const messages = db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);

    const attachmentsByMsg = db.prepare(
      `SELECT id, message_id, alias, filename, mimetype, size
       FROM attachments WHERE chat_id = ? ORDER BY created_at ASC`
    ).all(req.params.id).reduce((acc, a) => {
      (acc[a.message_id] ||= []).push({
        id: a.id, alias: a.alias, filename: a.filename, mimetype: a.mimetype, size: a.size,
        url: `/uploads/${req.params.id}/${a.id}-${a.filename}`,
      });
      return acc;
    }, {});

    const messagesWithAttachments = messages.map(m => ({
      ...m,
      attachments: attachmentsByMsg[m.id] || [],
    }));

    const children = db.prepare(
      'SELECT * FROM chats WHERE parent_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);

    res.json({ ...chat, messages: messagesWithAttachments, children });
  });

  // Create new chat
  router.post('/', (req, res) => {
    const { title, parent_id, parent_word } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO chats (id, title, parent_id, parent_word, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, title, parent_id || null, parent_word || null, now);

    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    res.status(201).json(chat);
  });

  // Update chat title
  router.patch('/:id', (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, req.params.id);
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  });

  // Delete chat and all children
  router.delete('/:id', (req, res) => {
    const deleteRecursive = (id) => {
      const children = db.prepare('SELECT id FROM chats WHERE parent_id = ?').all(id);
      children.forEach(child => deleteRecursive(child.id));
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
      db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    };
    deleteRecursive(req.params.id);
    res.json({ success: true });
  });

  return router;
};

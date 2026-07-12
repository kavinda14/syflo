/**
 * routes/papers.js
 *
 * Minimal papers routes, ported from Syflo without the Marker parsing
 * pipeline (PRD non-goal): a paper is just a stored PDF bound to a chat
 * tree. ADR-0002: one PDF per chat tree — the tree's ROOT chat carries
 * paper_id; uploading from any branch binds to the root, and a second
 * upload into the same tree is rejected with 'tree-has-pdf' so the
 * frontend can prompt for a new tree.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

module.exports = (db, uploadsDir) => {
  const router = express.Router();
  const papersDir = path.join(uploadsDir, 'papers');
  fs.mkdirSync(papersDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: papersDir,
      filename: (req, file, cb) => {
        const id = randomUUID();
        cb(null, `${id}.pdf`);
        req._paperId = id;
      },
    }),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    fileFilter: (req, file, cb) => {
      if (file.mimetype !== 'application/pdf') {
        return cb(new Error('Only PDF files are accepted'));
      }
      cb(null, true);
    },
  });

  const getChat = db.prepare('SELECT * FROM chats WHERE id = ?');
  const getPaper = db.prepare('SELECT * FROM papers WHERE id = ?');
  const insertPaper = db.prepare(`
    INSERT INTO papers (id, title, authors_json, uploaded_at, pdf_path, status)
    VALUES (@id, @title, @authors_json, @uploaded_at, @pdf_path, @status)
  `);
  const bindPaperToChat = db.prepare('UPDATE chats SET paper_id = ? WHERE id = ?');

  // Walk parent_id up to the tree root. The root carries the tree's paper_id.
  function resolveRoot(chatId) {
    let chat = getChat.get(chatId);
    while (chat && chat.parent_id) chat = getChat.get(chat.parent_id);
    return chat || null;
  }

  function formatPaper(row) {
    return {
      id: row.id,
      title: row.title,
      authors: row.authors_json ? JSON.parse(row.authors_json) : [],
      uploaded_at: row.uploaded_at,
      status: row.status,
      pdf_url: `/api/papers/${row.id}/pdf`,
    };
  }

  // POST /api/papers — upload a PDF (multipart field "pdf") and bind it to
  // the chat tree of `chat_id`. No parsing: the paper is 'ready' immediately.
  router.post('/', upload.single('pdf'), (req, res) => {
    const discardUpload = () => {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (_) { /* already gone */ }
      }
    };
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF uploaded (field name must be "pdf")' });
    }
    const chatId = (req.body.chat_id || '').toString();
    if (!chatId) {
      discardUpload();
      return res.status(400).json({ error: 'chat_id is required' });
    }
    const root = resolveRoot(chatId);
    if (!root) {
      discardUpload();
      return res.status(404).json({ error: 'Chat not found' });
    }
    if (root.paper_id) {
      discardUpload();
      return res.status(409).json({ error: 'tree-has-pdf', root_chat_id: root.id });
    }

    const row = {
      id: req._paperId,
      title: req.file.originalname.replace(/\.pdf$/i, ''),
      authors_json: null,
      uploaded_at: new Date().toISOString(),
      pdf_path: req.file.path,
      status: 'ready',
    };
    insertPaper.run(row);
    bindPaperToChat.run(row.id, root.id);
    return res.status(201).json(formatPaper(row));
  });

  // GET /api/papers/for-chat/:chatId — the paper bound to this chat's tree
  // (resolved via the root), or { paper: null }. Used to restore the
  // three-column view on reload.
  router.get('/for-chat/:chatId', (req, res) => {
    const root = resolveRoot(req.params.chatId);
    if (!root) return res.status(404).json({ error: 'Chat not found' });
    if (!root.paper_id) return res.json({ paper: null });
    const row = getPaper.get(root.paper_id);
    return res.json({ paper: row ? formatPaper(row) : null });
  });

  // GET /api/papers/:id — paper metadata.
  router.get('/:id', (req, res) => {
    const row = getPaper.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Paper not found' });
    res.json(formatPaper(row));
  });

  // GET /api/papers/:id/pdf — serve the stored PDF (rendered by pdf.js).
  router.get('/:id/pdf', (req, res) => {
    const row = getPaper.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Paper not found' });
    if (!row.pdf_path || !fs.existsSync(row.pdf_path)) {
      return res.status(404).json({ error: 'PDF file missing on disk' });
    }
    res.type('application/pdf').sendFile(path.resolve(row.pdf_path));
  });

  return router;
};

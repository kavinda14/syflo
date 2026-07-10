/**
 * messages.js
 *
 * Nimmt User-Nachrichten an (text + optionale Datei-Anhänge per multipart),
 * speichert die Dateien, baut multimodale Anfragen für llama3.2-vision und
 * streamt die Antwort per SSE zurück.
 *
 * Datei-Handling:
 *   - Bilder (image/*): per data-URL als image_url an das Vision-Modell
 *   - Text-Dateien (text/*, application/json): Inhalt einlesen und in den Prompt einbetten
 *   - Sonstige Dateien: nur Name/Mimetype erwähnen (Modell kann Binär nicht lesen)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getLLMClient } = require('../llm');
const { streamWithTools } = require('../tools');

const MAX_TEXT_FILE_BYTES = 64 * 1024;

module.exports = (db, UPLOADS_DIR) => {
  const router = express.Router({ mergeParams: true });

  // Anhänge ins chat-spezifische Verzeichnis legen, damit man pro Chat
  // aufräumen kann und keine Dateinamen-Kollisionen entstehen.
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOADS_DIR, req.params.chatId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Dateiname: <id>-<originalname> — id für Eindeutigkeit, originalname für Lesbarkeit
      const id = crypto.randomUUID();
      // Originalnamen säubern (keine Pfade)
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      file.attachmentId = id;
      cb(null, `${id}-${safe}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB pro Datei
  });

  // Hilfsfunktion: liest eine Datei und gibt sie als data-URL zurück.
  function fileToDataUrl(fullPath, mimetype) {
    const data = fs.readFileSync(fullPath);
    return `data:${mimetype};base64,${data.toString('base64')}`;
  }

  // Hilfsfunktion: liest eine Textdatei (begrenzt auf MAX_TEXT_FILE_BYTES)
  function readTextFile(fullPath) {
    const stat = fs.statSync(fullPath);
    const len = Math.min(stat.size, MAX_TEXT_FILE_BYTES);
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    return buf.toString('utf-8') + (stat.size > len ? '\n[…gekürzt]' : '');
  }

  // Wandelt einen DB-Anhang in den OpenAI-Multimodal-Content-Eintrag.
  // Gibt entweder ein image_url-Objekt zurück, oder null (bei Textdateien wird
  // der Inhalt in den Prompt-Text eingebettet — separat behandelt).
  function attachmentToMultimodalContent(att) {
    if (att.mimetype.startsWith('image/')) {
      return {
        type: 'image_url',
        image_url: { url: fileToDataUrl(att.path, att.mimetype) },
      };
    }
    return null;
  }

  // Baut den Text-Annex für nicht-bildliche Anhänge:
  // - Text-Dateien: kompletter Inhalt
  // - Sonstige: nur Verweis auf Dateiname
  function buildAttachmentTextAnnex(attachments) {
    const parts = [];
    for (const att of attachments) {
      if (att.mimetype.startsWith('image/')) continue;
      const isText = att.mimetype.startsWith('text/') ||
                     att.mimetype === 'application/json' ||
                     /\.(md|txt|csv|log|js|ts|py|html|css|json|yaml|yml)$/i.test(att.filename);
      if (isText) {
        try {
          const content = readTextFile(att.path);
          parts.push(`\n\n[Anhang ${att.alias} — ${att.filename}]\n\`\`\`\n${content}\n\`\`\``);
        } catch (_) {
          parts.push(`\n\n[Anhang ${att.alias} — ${att.filename}, Fehler beim Lesen]`);
        }
      } else {
        parts.push(`\n\n[Anhang ${att.alias} — ${att.filename}, Typ ${att.mimetype} (Binärdatei, kann nicht gelesen werden)]`);
      }
    }
    return parts.join('');
  }

  // POST /api/chats/:chatId/messages
  // Akzeptiert sowohl JSON (alte Clients) als auch multipart/form-data (mit Dateien).
  // Multipart-Felder: text, aliases (JSON-Array), files (Datei-Inputs)
  router.post('/', upload.array('files', 8), async (req, res) => {
    // Inhalt aus JSON oder Multipart
    const content = req.body.content || req.body.text || '';
    const aliases = req.body.aliases ? JSON.parse(req.body.aliases) : [];
    if (!content && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: 'content or files required' });
    }

    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // User-Nachricht speichern
    const userMsgId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userMsgId, req.params.chatId, 'user', content, now);

    // Anhänge speichern
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const alias = aliases[i] || `@datei${i + 1}`;
        const id = file.attachmentId;
        db.prepare(
          `INSERT INTO attachments (id, message_id, chat_id, alias, filename, mimetype, path, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, userMsgId, req.params.chatId, alias, file.originalname, file.mimetype, file.path, file.size, now);
        attachments.push({
          id, message_id: userMsgId, alias,
          filename: file.originalname, mimetype: file.mimetype, path: file.path, size: file.size,
        });
      }
    }

    // Kontext aufbauen — System-Prompt + Eltern-Chat (falls Branch) + Historie
    const contextMessages = [];
    const systemBase = 'You are a friendly and helpful assistant. Formatting rules: (1) Use proper Markdown for headings — always include a SPACE between the hash characters and the heading text: `# Heading`, `## Subheading`, `### Sub-subheading`. Never write `#Heading` without a space — it will not render as a heading. (2) Place ONE relevant emoji at the start of each markdown heading or bolded section title to act as a visual anchor for that section. Do NOT use emojis inside regular sentences, paragraphs, or list items — keep prose plain so it reads cleanly. (3) When explaining concepts, always use analogies and real-world comparisons to make things easy to understand. (4) When the user attaches images, examine them carefully and describe what you see when relevant.';

    if (chat.parent_id) {
      const parentMessages = db.prepare(
        'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
      ).all(chat.parent_id);
      contextMessages.push({
        role: 'system',
        content: `${systemBase} The user is exploring the term "${chat.parent_word}" from a previous conversation. Context:\n\n${parentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
      });
    } else {
      contextMessages.push({ role: 'system', content: systemBase });
    }

    // Historie (nur Text — alte Anhänge werden im Kontext nicht erneut hochgeschickt,
    // sonst wird der Prompt zu groß)
    const history = db.prepare(
      'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).all(req.params.chatId);
    // Letzte (aktuelle) User-Nachricht weglassen — die fügen wir multimodal hinzu
    history.slice(0, -1).forEach(m => contextMessages.push({ role: m.role, content: m.content }));

    // Aktuelle User-Nachricht: multimodal mit Bildern + Text-Annex für andere Dateien
    const imageContents = attachments.map(attachmentToMultimodalContent).filter(Boolean);
    const textAnnex = buildAttachmentTextAnnex(attachments);
    const fullText = content + textAnnex;

    if (imageContents.length > 0) {
      contextMessages.push({
        role: 'user',
        content: [{ type: 'text', text: fullText }, ...imageContents],
      });
    } else {
      contextMessages.push({ role: 'user', content: fullText });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { client, model } = getLLMClient(db);

      // Tool-Use-Loop: das LLM darf eigenständig web_search aufrufen. Beim
      // Tool-Call streamen wir spezielle SSE-Events ans Frontend, damit es
      // "Searching the web…" anzeigen und die Quellen unter der Antwort
      // auflisten kann.
      const fullContent = await streamWithTools({
        client,
        model,
        messages: contextMessages,
        onText: (delta) => {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        },
        onToolEvent: (evt) => {
          res.write(`data: ${JSON.stringify({ tool: evt })}\n\n`);
        },
      });

      const assistantMsgId = crypto.randomUUID();
      const assistantNow = new Date().toISOString();
      db.prepare(
        'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(assistantMsgId, req.params.chatId, 'assistant', fullContent, assistantNow);

      // Titel-Generierung wie bisher
      const msgCount = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?'
      ).get(req.params.chatId);

      if (chat.title === 'New Chat' || msgCount.count <= 2) {
        // Hard caps so the sidebar list and mindmap stay readable even if the
        // LLM ignores the word-limit instruction (some smaller models do).
        const MAX_TITLE_WORDS = 4;
        const MAX_TITLE_CHARS = 40;

        // Fallback: first few words of the user's message, in case the LLM call fails.
        let newTitle = (content || 'Chat')
          .trim()
          .split(/\s+/)
          .slice(0, MAX_TITLE_WORDS)
          .join(' ');

        try {
          const { client: titleClient, model: titleModel } = getLLMClient(db);
          const titleCompletion = await titleClient.chat.completions.create({
            model: titleModel,
            messages: [
              {
                role: 'system',
                content:
                  'Generate a 2 to 4 word title for this chat. ' +
                  'Output ONLY the title — no quotes, no punctuation, no markdown, no labels, no extra commentary. ' +
                  'Examples: React hooks tutorial / Bicycle repair guide / Berlin trip planning / Linear algebra basics.',
              },
              { role: 'user', content: content || 'New chat' },
            ],
          });
          const raw = titleCompletion.choices[0]?.message?.content || '';
          if (raw.trim()) newTitle = raw.trim();
        } catch (_) { /* Fallback genügt */ }

        // Sanitize whatever the LLM returned: strip wrapping quotes/backticks,
        // strip trailing punctuation, drop any line breaks the model added, and
        // enforce the word + character caps.
        newTitle = newTitle
          .replace(/[\r\n]+/g, ' ')
          .replace(/^["'`*_]+|["'`*_.!?,;:]+$/g, '')
          .trim()
          .split(/\s+/)
          .slice(0, MAX_TITLE_WORDS)
          .join(' ');
        if (newTitle.length > MAX_TITLE_CHARS) {
          newTitle = newTitle.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + '…';
        }
        if (!newTitle) newTitle = 'New Chat';

        db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(newTitle, req.params.chatId);
      }

      // Anhänge mit URLs für Frontend
      const userAttachments = attachments.map(a => ({
        id: a.id, alias: a.alias, filename: a.filename, mimetype: a.mimetype, size: a.size,
        url: `/uploads/${req.params.chatId}/${a.id}-${a.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`,
      }));

      const userMessage = {
        id: userMsgId, chat_id: req.params.chatId, role: 'user', content, created_at: now,
        attachments: userAttachments,
      };
      const assistantMessage = {
        id: assistantMsgId, chat_id: req.params.chatId, role: 'assistant', content: fullContent, created_at: assistantNow,
        attachments: [],
      };

      res.write(`data: ${JSON.stringify({ done: true, userMessage, assistantMessage })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  });

  return router;
};

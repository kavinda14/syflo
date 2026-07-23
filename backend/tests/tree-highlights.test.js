process.env.OPENAI_API_KEY = 'test-key-for-unit-tests';
const request = require('supertest');
const { createApp } = require('../server');
const { createDb } = require('../database');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'tree-highlights.test.db');

let app;
let db;

// Fixture: ein Baum mit Paper —
//   root (paper_id=paper-1)
//   └── branch-1 (eine Nachricht msg-1)
// Der Endpoint soll PDF- und Chat-Highlights des GANZEN Baums vereint liefern.
beforeEach(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = createDb(TEST_DB_PATH);
  app = createApp(db);

  db.prepare(
    'INSERT INTO papers (id, uploaded_at, pdf_path, status) VALUES (?, ?, ?, ?)',
  ).run('paper-1', '2026-07-01T00:00:00.000Z', '/dev/null', 'ready');
  db.prepare(
    'INSERT INTO chats (id, title, created_at, paper_id) VALUES (?, ?, ?, ?)',
  ).run('root', 'CB-MCTS paper', '2026-07-01T00:00:00.000Z', 'paper-1');
  db.prepare(
    'INSERT INTO chats (id, title, parent_id, created_at) VALUES (?, ?, ?, ?)',
  ).run('branch-1', 'entropy bonus', 'root', '2026-07-02T00:00:00.000Z');
  db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
  ).run('msg-1', 'branch-1', 'the entropy bonus is annealed', '2026-07-02T00:01:00.000Z');
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

function makeRects() {
  return [{ left: 10, top: 20, width: 100, height: 14 }];
}

async function createPdfHighlight(overrides = {}) {
  const res = await request(app).post('/api/papers/paper-1/highlights').send({
    color: 'yellow', text: 'CB-MCTS', pageNumber: 3, rects: makeRects(),
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function createChatHighlight(overrides = {}) {
  const res = await request(app).post('/api/chats/branch-1/message-highlights').send({
    messageId: 'msg-1', color: 'orange', text: 'annealed', startOffset: 22, endOffset: 30,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('GET /api/chats/:id/tree-highlights', () => {
  it('liefert Dokumentreihenfolge: PDF nach Seite, dann Chats in Baum-Reihenfolge', async () => {
    // Zweiter Branch, NACH branch-1 erstellt, mit eigener Nachricht.
    db.prepare(
      'INSERT INTO chats (id, title, parent_id, created_at) VALUES (?, ?, ?, ?)',
    ).run('branch-2', 'marginal contribution', 'root', '2026-07-03T00:00:00.000Z');
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
    ).run('msg-2', 'branch-2', 'the Shapley-value connection', '2026-07-03T00:01:00.000Z');
    // Nachricht im Root-Chat — Root kommt in Baum-Reihenfolge vor den Branches.
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
    ).run('msg-root', 'root', 'softmax sampling avoids brittleness', '2026-07-01T00:01:00.000Z');

    // PDF-Highlights absichtlich in "falscher" Reihenfolge angelegt: Seite 5 zuerst.
    await createPdfHighlight({ text: 'page five', pageNumber: 5 });
    await createPdfHighlight({ text: 'page two', pageNumber: 2 });

    // Chat-Highlights kreuz und quer angelegt: branch-2 zuerst, dann root,
    // dann zwei in branch-1 mit absteigenden Offsets in derselben Nachricht.
    await request(app).post('/api/chats/branch-2/message-highlights').send({
      messageId: 'msg-2', color: 'blue', text: 'Shapley', startOffset: 4, endOffset: 11,
    });
    await request(app).post('/api/chats/root/message-highlights').send({
      messageId: 'msg-root', color: 'green', text: 'softmax', startOffset: 0, endOffset: 7,
    });
    await createChatHighlight({ text: 'annealed', startOffset: 22, endOffset: 30 });
    await createChatHighlight({ text: 'entropy', startOffset: 4, endOffset: 11 });

    const res = await request(app).get('/api/chats/root/tree-highlights');
    expect(res.status).toBe(200);
    expect(res.body.map((h) => h.text)).toEqual([
      'page two',    // PDF, Seite 2
      'page five',   // PDF, Seite 5
      'softmax',     // Chat: root zuerst
      'entropy',     // Chat: branch-1 (älter als branch-2), Offset 4 vor 22
      'annealed',    // Chat: branch-1, Offset 22
      'Shapley',     // Chat: branch-2 zuletzt
    ]);
  });

  it('vereint PDF- und Chat-Highlights des Baums mit Quell-Metadaten', async () => {
    const pdfH = await createPdfHighlight();
    const chatH = await createChatHighlight();

    const res = await request(app).get('/api/chats/root/tree-highlights');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const pdfItem = res.body.find((h) => h.kind === 'pdf');
    expect(pdfItem).toMatchObject({
      id: pdfH.id,
      kind: 'pdf',
      color: 'yellow',
      text: 'CB-MCTS',
      paperId: 'paper-1',
      pageNumber: 3,
    });
    expect(pdfItem.rects).toHaveLength(1);

    const chatItem = res.body.find((h) => h.kind === 'chat');
    expect(chatItem).toMatchObject({
      id: chatH.id,
      kind: 'chat',
      color: 'orange',
      text: 'annealed',
      chatId: 'branch-1',
      chatTitle: 'entropy bonus',
      messageId: 'msg-1',
      startOffset: 22,
      endOffset: 30,
    });
  });

  it('löst von einer Branch-ID zum Root auf — gleiche Antwort wie mit Root-ID', async () => {
    await createPdfHighlight();
    await createChatHighlight();

    const viaRoot = await request(app).get('/api/chats/root/tree-highlights');
    const viaBranch = await request(app).get('/api/chats/branch-1/tree-highlights');
    expect(viaBranch.status).toBe(200);
    expect(viaBranch.body).toEqual(viaRoot.body);
  });

  it('liefert keine Highlights fremder Bäume', async () => {
    // Zweiter, unabhängiger Baum mit eigenem Paper, Chat, Nachricht und Highlights.
    db.prepare(
      'INSERT INTO papers (id, uploaded_at, pdf_path, status) VALUES (?, ?, ?, ?)',
    ).run('paper-other', '2026-07-05T00:00:00.000Z', '/dev/null', 'ready');
    db.prepare(
      'INSERT INTO chats (id, title, created_at, paper_id) VALUES (?, ?, ?, ?)',
    ).run('other-root', 'other tree', '2026-07-05T00:00:00.000Z', 'paper-other');
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
    ).run('msg-other', 'other-root', 'unrelated text here', '2026-07-05T00:01:00.000Z');
    await request(app).post('/api/papers/paper-other/highlights').send({
      color: 'pink', text: 'foreign pdf', pageNumber: 1, rects: makeRects(),
    });
    await request(app).post('/api/chats/other-root/message-highlights').send({
      messageId: 'msg-other', color: 'pink', text: 'unrelated', startOffset: 0, endOffset: 9,
    });

    await createPdfHighlight();
    await createChatHighlight();

    const res = await request(app).get('/api/chats/root/tree-highlights');
    expect(res.body).toHaveLength(2);
    expect(res.body.every((h) => h.color !== 'pink')).toBe(true);
  });

  it('gibt 404 für unbekannte Chat-ID', async () => {
    const res = await request(app).get('/api/chats/missing/tree-highlights');
    expect(res.status).toBe(404);
  });

  it('funktioniert für Bäume ohne PDF — nur Chat-Highlights', async () => {
    db.prepare(
      'INSERT INTO chats (id, title, created_at) VALUES (?, ?, ?)',
    ).run('nopdf-root', 'plain tree', '2026-07-06T00:00:00.000Z');
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
    ).run('msg-nopdf', 'nopdf-root', 'just chatting along', '2026-07-06T00:01:00.000Z');
    await request(app).post('/api/chats/nopdf-root/message-highlights').send({
      messageId: 'msg-nopdf', color: 'green', text: 'chatting', startOffset: 5, endOffset: 13,
    });

    const res = await request(app).get('/api/chats/nopdf-root/tree-highlights');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].kind).toBe('chat');
  });
});

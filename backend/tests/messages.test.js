/**
 * tests/messages.test.js
 *
 * Integration tests for POST /api/chats/:chatId/messages.
 * This endpoint streams SSE events, so the tests parse the raw response text
 * to extract and verify each event.
 *
 * The Ollama client is mocked. The first call to mockCreate returns an async
 * iterable (simulating the streaming response). The second call returns a plain
 * object (simulating the title-generation follow-up call).
 */

jest.mock('openai');
const OpenAI = require('openai');

const request = require('supertest');
const { createApp } = require('../server');
const { createDb } = require('../database');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'messages_test.db');

let app;
let db;
let mockCreate;

// Helper: creates an async iterable that yields streaming chunks, mimicking
// what Ollama returns when stream: true is set.
function makeStream(words) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const word of words) {
        yield { choices: [{ delta: { content: word } }] };
      }
      // Final chunk has an empty delta — signals end of stream
      yield { choices: [{ delta: {} }] };
    },
  };
}

// Helper: parse SSE event text into an array of parsed JSON objects.
function parseSSE(text) {
  return text
    .split('\n\n')
    .filter(block => block.startsWith('data: '))
    .map(block => JSON.parse(block.slice(6)));
}

beforeEach(() => {
  mockCreate = jest.fn();
  OpenAI.mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = createDb(TEST_DB_PATH);
  app = createApp(db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

// ─── Validation ─────────────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages – validation', () => {
  it('returns 400 when content is missing', async () => {
    // Create a real chat first so the route can find it
    const chat = await request(app).post('/api/chats').send({ title: 'Test' });
    const res = await request(app)
      .post(`/api/chats/${chat.body.id}/messages`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when the chat does not exist', async () => {
    // No mock needed — the route checks the DB before calling Ollama
    const res = await request(app)
      .post('/api/chats/nonexistent-id/messages')
      .send({ content: 'Hello' });
    expect(res.status).toBe(404);
  });
});

// ─── Streaming response ──────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages – streaming', () => {
  let chatId;

  beforeEach(async () => {
    const chat = await request(app).post('/api/chats').send({ title: 'Stream Test' });
    chatId = chat.body.id;
  });

  it('streams delta events for each word', async () => {
    // First call: streaming response with two words
    mockCreate.mockResolvedValueOnce(makeStream(['Hello', ' world']));
    // Second call: title generation (non-streaming)
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello World Chat' } }],
    });

    const res = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .send({ content: 'Hi' })
      .buffer(true);

    const events = parseSSE(res.text);
    const deltas = events.filter(e => e.delta).map(e => e.delta);
    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('ends the stream with a done event containing both messages', async () => {
    mockCreate.mockResolvedValueOnce(makeStream(['Test reply']));
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Test Chat Title' } }],
    });

    const res = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .send({ content: 'Hello' })
      .buffer(true);

    const events = parseSSE(res.text);
    const doneEvent = events.find(e => e.done);

    expect(doneEvent).toBeDefined();
    expect(doneEvent.userMessage.role).toBe('user');
    expect(doneEvent.userMessage.content).toBe('Hello');
    expect(doneEvent.assistantMessage.role).toBe('assistant');
    expect(doneEvent.assistantMessage.content).toBe('Test reply');
  });

  it('saves both messages to the database after streaming', async () => {
    mockCreate.mockResolvedValueOnce(makeStream(['DB test reply']));
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'DB Test Title' } }],
    });

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .send({ content: 'Save me' })
      .buffer(true);

    // Verify the messages were persisted by fetching the chat
    const chatRes = await request(app).get(`/api/chats/${chatId}`);
    expect(chatRes.body.messages).toHaveLength(2);
    expect(chatRes.body.messages[0].role).toBe('user');
    expect(chatRes.body.messages[0].content).toBe('Save me');
    expect(chatRes.body.messages[1].role).toBe('assistant');
    expect(chatRes.body.messages[1].content).toBe('DB test reply');
  });

  it('auto-generates and saves the chat title after the first message', async () => {
    mockCreate.mockResolvedValueOnce(makeStream(['Reply']));
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Auto Generated Title' } }],
    });

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .send({ content: 'Hello' })
      .buffer(true);

    const chatRes = await request(app).get(`/api/chats/${chatId}`);
    expect(chatRes.body.title).toBe('Auto Generated Title');
  });
});

// ─── Parent chat context ─────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages – parent context', () => {
  it('includes parent chat messages in the system prompt for child chats', async () => {
    // Create parent chat and send a message to it
    const parent = await request(app).post('/api/chats').send({ title: 'Parent' });
    mockCreate.mockResolvedValueOnce(makeStream(['Parent reply']));
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'Parent Title' } }] });
    await request(app)
      .post(`/api/chats/${parent.body.id}/messages`)
      .send({ content: 'Parent question' })
      .buffer(true);

    // Create a child chat branched from the parent
    const child = await request(app).post('/api/chats').send({
      title: 'Child',
      parent_id: parent.body.id,
      parent_word: 'quantum',
    });

    mockCreate.mockResolvedValueOnce(makeStream(['Child reply']));
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'Child Title' } }] });

    await request(app)
      .post(`/api/chats/${child.body.id}/messages`)
      .send({ content: 'Child question' })
      .buffer(true);

    // The system message should reference the parent word and include parent context
    const callArgs = mockCreate.mock.calls[2][0]; // 3rd call (first two were for parent)
    const systemMessage = callArgs.messages.find(m => m.role === 'system');
    expect(systemMessage.content).toContain('quantum');
    expect(systemMessage.content).toContain('Parent question');
  });
});

// ─── Paper context ───────────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages – paper context', () => {
  // App with an injected fake PDF-text extractor (no real pdf.js in this suite).
  function appWithExtractor(extractFn) {
    return createApp(db, { messages: { extractPdfTextFn: extractFn } });
  }

  function bindPaperToChat(chatId) {
    db.prepare(
      'INSERT INTO papers (id, title, uploaded_at, pdf_path, status) VALUES (?, ?, ?, ?, ?)',
    ).run('paper-1', 'Attention Is All You Need', new Date().toISOString(), '/fake/paper.pdf', 'ready');
    db.prepare('UPDATE chats SET paper_id = ? WHERE id = ?').run('paper-1', chatId);
  }

  it('includes the attached paper text in the system prompt', async () => {
    const paperApp = appWithExtractor(jest.fn().mockResolvedValue('THE TRANSFORMER PAPER FULL TEXT'));
    const chat = await request(paperApp).post('/api/chats').send({ title: 'Paper Chat' });
    bindPaperToChat(chat.body.id);

    mockCreate.mockResolvedValueOnce(makeStream(['Summary…']));
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'Paper Title' } }] });

    await request(paperApp)
      .post(`/api/chats/${chat.body.id}/messages`)
      .send({ content: 'give me a summary' })
      .buffer(true);

    const systemMessage = mockCreate.mock.calls[0][0].messages.find(m => m.role === 'system');
    expect(systemMessage.content).toContain('Attention Is All You Need');
    expect(systemMessage.content).toContain('THE TRANSFORMER PAPER FULL TEXT');
  });

  it('branch chats inherit the tree paper context', async () => {
    const paperApp = appWithExtractor(jest.fn().mockResolvedValue('ROOT PAPER TEXT'));
    const root = await request(paperApp).post('/api/chats').send({ title: 'Root' });
    bindPaperToChat(root.body.id);
    const child = await request(paperApp).post('/api/chats').send({
      title: 'Child',
      parent_id: root.body.id,
      parent_word: 'attention',
    });

    mockCreate.mockResolvedValueOnce(makeStream(['Reply']));
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'T' } }] });

    await request(paperApp)
      .post(`/api/chats/${child.body.id}/messages`)
      .send({ content: 'what does the paper say?' })
      .buffer(true);

    const systemMessage = mockCreate.mock.calls[0][0].messages.find(m => m.role === 'system');
    expect(systemMessage.content).toContain('ROOT PAPER TEXT');
  });

  it('degrades to a normal chat when extraction fails', async () => {
    const paperApp = appWithExtractor(jest.fn().mockRejectedValue(new Error('corrupt')));
    const chat = await request(paperApp).post('/api/chats').send({ title: 'Broken PDF' });
    bindPaperToChat(chat.body.id);

    mockCreate.mockResolvedValueOnce(makeStream(['Still works']));
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'T' } }] });

    const res = await request(paperApp)
      .post(`/api/chats/${chat.body.id}/messages`)
      .send({ content: 'hello' })
      .buffer(true);

    const events = parseSSE(res.text);
    expect(events.filter(e => e.delta).map(e => e.delta)).toEqual(['Still works']);
    const systemMessage = mockCreate.mock.calls[0][0].messages.find(m => m.role === 'system');
    expect(systemMessage.content).not.toContain('PAPER TEXT START');
  });
});

/**
 * tests/explain.test.js
 *
 * Integration tests for POST /api/explain.
 * The Ollama client (OpenAI SDK) is mocked so these tests run without a
 * running Ollama server. Each test controls exactly what the mock returns.
 */

// Mock the openai module before anything else is required.
// jest.mock is hoisted so the mock is in place when routes/explain.js is loaded.
jest.mock('openai');
const OpenAI = require('openai');

const request = require('supertest');
const { createApp } = require('../server');
const { createDb } = require('../database');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'explain_test.db');

let app;
let db;
let mockCreate;

beforeEach(() => {
  // Create a fresh mock for `chat.completions.create` before each test so
  // tests don't share return values.
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

describe('POST /api/explain – validation', () => {
  it('returns 400 when word is missing', async () => {
    const res = await request(app).post('/api/explain').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when word is an empty string', async () => {
    const res = await request(app).post('/api/explain').send({ word: '' });
    expect(res.status).toBe(400);
  });
});

// ─── Successful responses ────────────────────────────────────────────────────

describe('POST /api/explain – success', () => {
  it('returns an explanation for a word', async () => {
    // Mock Ollama returning an explanation
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Quantum is the smallest discrete unit of energy.' } }],
    });

    const res = await request(app)
      .post('/api/explain')
      .send({ word: 'quantum' });

    expect(res.status).toBe(200);
    expect(res.body.explanation).toBe('Quantum is the smallest discrete unit of energy.');
    // Definitionen müssen sofort kommen — Denk-Modelle dürfen hier nie grübeln.
    expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe('none');
  });

  it('passes context to the model when provided', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'In this context, entropy means disorder.' } }],
    });

    await request(app)
      .post('/api/explain')
      .send({ word: 'entropy', context: 'thermodynamics lecture' });

    // The model should have been called with a prompt that includes the context
    const calledWith = mockCreate.mock.calls[0][0];
    const userMessage = calledWith.messages.find(m => m.role === 'user');
    expect(userMessage.content).toContain('entropy');
    expect(userMessage.content).toContain('thermodynamics lecture');
  });

  it('works without context (word only)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Serendipity means a happy accident.' } }],
    });

    const res = await request(app)
      .post('/api/explain')
      .send({ word: 'serendipity' });

    expect(res.status).toBe(200);
    expect(res.body.explanation).toBeDefined();
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe('POST /api/explain – error handling', () => {
  it('returns 500 when Ollama is unavailable', async () => {
    mockCreate.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

    const res = await request(app)
      .post('/api/explain')
      .send({ word: 'quantum' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('ECONNREFUSED');
  });
});

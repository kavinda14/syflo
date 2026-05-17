/**
 * tests/settings.test.js
 *
 * Integration tests for GET/PUT /api/settings + LLM-Provider-Switch.
 * Mocks the OpenAI SDK so we can verify which baseURL/apiKey the helper
 * instantiates when the active provider is changed.
 */

jest.mock('openai');
const OpenAI = require('openai');

const request = require('supertest');
const { createApp } = require('../server');
const { createDb } = require('../database');
const { getLLMClient } = require('../llm');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'settings_test.db');

let app;
let db;

beforeEach(() => {
  // Default mock: any key passes validation (models.list resolves successfully).
  // Individual tests can override the models.list behaviour to simulate failures.
  OpenAI.mockImplementation((opts) => ({
    _opts: opts,
    chat: { completions: { create: jest.fn() } },
    models: { list: jest.fn().mockResolvedValue({ data: [] }) },
  }));
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = createDb(TEST_DB_PATH);
  app = createApp(db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

describe('GET /api/settings', () => {
  it('returns defaults when nothing is configured', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      llm_provider: 'ollama',
      openai_model: 'gpt-4o-mini',
      ollama_model: 'llama3.2-vision:11b',
      openai_api_key_set: false,
    });
  });

  it('never returns the raw API key', async () => {
    await request(app).put('/api/settings').send({ openai_api_key: 'sk-supersecret' });
    const res = await request(app).get('/api/settings');
    expect(JSON.stringify(res.body)).not.toContain('sk-supersecret');
    expect(res.body.openai_api_key_set).toBe(true);
  });
});

describe('PUT /api/settings', () => {
  it('updates only the fields that are sent', async () => {
    const res = await request(app).put('/api/settings').send({ llm_provider: 'openai' });
    expect(res.status).toBe(200);
    expect(res.body.llm_provider).toBe('openai');
    // Other fields keep their defaults
    expect(res.body.openai_model).toBe('gpt-4o-mini');
  });

  it('rejects invalid providers', async () => {
    const res = await request(app).put('/api/settings').send({ llm_provider: 'gemini' });
    expect(res.status).toBe(400);
  });

  it('lets the user clear the API key with empty string', async () => {
    await request(app).put('/api/settings').send({ openai_api_key: 'sk-abc' });
    await request(app).put('/api/settings').send({ openai_api_key: '' });
    const res = await request(app).get('/api/settings');
    expect(res.body.openai_api_key_set).toBe(false);
  });
});

describe('getLLMClient – provider switching', () => {
  it('returns an Ollama-pointed client by default', () => {
    const { client, model, provider } = getLLMClient(db);
    expect(provider).toBe('ollama');
    expect(model).toBe('llama3.2-vision:11b');
    expect(client._opts.baseURL).toBe('http://localhost:11434/v1');
  });

  it('returns an OpenAI-pointed client when configured', async () => {
    await request(app).put('/api/settings').send({
      llm_provider: 'openai',
      openai_api_key: 'sk-test-123',
      openai_model: 'gpt-4o',
    });
    const { client, model, provider } = getLLMClient(db);
    expect(provider).toBe('openai');
    expect(model).toBe('gpt-4o');
    expect(client._opts.apiKey).toBe('sk-test-123');
    // No baseURL override → SDK uses the real OpenAI endpoint
    expect(client._opts.baseURL).toBeUndefined();
  });

  it('throws a friendly 400 error when OpenAI is selected without a key', async () => {
    await request(app).put('/api/settings').send({ llm_provider: 'openai' });
    expect(() => getLLMClient(db)).toThrow(/no API key/i);
  });
});

describe('PUT /api/settings – key validation', () => {
  it('rejects an invalid OpenAI key with a 400 and does not store it', async () => {
    // Override the default mock so models.list throws a 401 like the real SDK does.
    OpenAI.mockImplementation(() => ({
      models: {
        list: jest.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 })),
      },
    }));

    const res = await request(app).put('/api/settings').send({ openai_api_key: 'sk-totally-wrong' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid|revoked/i);

    // Check the bad key was NOT persisted.
    const get = await request(app).get('/api/settings');
    expect(get.body.openai_api_key_set).toBe(false);
  });

  it('accepts a valid key and persists it', async () => {
    // Default mock already resolves successfully — simulate a working key.
    const res = await request(app).put('/api/settings').send({ openai_api_key: 'sk-works' });
    expect(res.status).toBe(200);
    expect(res.body.openai_api_key_set).toBe(true);
  });

  it('skips validation when no key field is sent (changing only the model)', async () => {
    // Even though models.list would fail, no key was sent, so PUT should succeed.
    OpenAI.mockImplementation(() => ({
      models: { list: jest.fn().mockRejectedValue(new Error('should not be called')) },
    }));

    const res = await request(app).put('/api/settings').send({ openai_model: 'gpt-4o' });
    expect(res.status).toBe(200);
    expect(res.body.openai_model).toBe('gpt-4o');
  });
});

describe('GET /api/settings/ollama-models', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('returns the list of locally installed models when Ollama responds', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3.2-vision:11b', size: 7816589186, details: { parameter_size: '10.7B' } },
          { name: 'phi4:latest', size: 9053116391, details: { parameter_size: '14.7B' } },
        ],
      }),
    });

    const res = await request(app).get('/api/settings/ollama-models');
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(2);
    expect(res.body.models[0]).toMatchObject({
      name: 'llama3.2-vision:11b',
      parameter_size: '10.7B',
    });
  });

  it('returns 503 with a helpful message when Ollama is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/api/settings/ollama-models');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ollama/i);
  });
});

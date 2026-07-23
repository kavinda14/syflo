/**
 * tests/system.test.js
 *
 * Integration tests for GET /api/system/recommendation — the hardware-based
 * model recommendation (design/mockup-model-picker.html, section 03).
 * System facts (RAM, platform) are injected via createApp options so tests
 * don't depend on the machine they run on.
 */

const request = require('supertest');
const { createApp } = require('../server');
const { createDb } = require('../database');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'system_test.db');
const GB = 1024 * 1024 * 1024;

let db;

function appWith(system) {
  return createApp(db, { system });
}

beforeEach(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = createDb(TEST_DB_PATH);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

describe('GET /api/system/recommendation', () => {
  test('recommends the medium ladder model on a 24 GB Mac', async () => {
    const app = appWith({ totalmem: () => 24 * GB, platform: () => 'darwin' });

    const res = await request(app).get('/api/system/recommendation');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      platform: 'darwin',
      totalMemGb: 24,
      recommendedModel: 'qwen3.5:9b',
    });
  });

  test('recommends the small ladder model below 16 GB', async () => {
    const app = appWith({ totalmem: () => 8 * GB, platform: () => 'darwin' });

    const res = await request(app).get('/api/system/recommendation');

    expect(res.body.recommendedModel).toBe('qwen3.5:4b');
  });

  test('recommends the large ladder model above 32 GB', async () => {
    const app = appWith({ totalmem: () => 48 * GB, platform: () => 'darwin' });

    const res = await request(app).get('/api/system/recommendation');

    expect(res.body.recommendedModel).toBe('gemma4:26b');
  });

  test('32 GB still counts as medium — large starts strictly above 32 GB', async () => {
    const app = appWith({ totalmem: () => 32 * GB, platform: () => 'darwin' });

    const res = await request(app).get('/api/system/recommendation');

    expect(res.body.recommendedModel).toBe('qwen3.5:9b');
  });

  test('steps one rung down on non-Apple platforms (GPU memory unknown)', async () => {
    // A 24 GB Linux box may have a small discrete GPU — without VRAM
    // detection the recommendation is conservative (ADR: platform rule).
    const app = appWith({ totalmem: () => 24 * GB, platform: () => 'linux' });

    const res = await request(app).get('/api/system/recommendation');

    expect(res.body.recommendedModel).toBe('qwen3.5:4b');
  });
});

/**
 * llm.js
 *
 * Zentrale Stelle, die den richtigen OpenAI-Client und Modellnamen
 * basierend auf den User-Settings zurückgibt. Damit muss kein Route mehr
 * direkt entscheiden, ob Ollama oder OpenAI verwendet wird.
 *
 * Settings-Tabelle (siehe database.js):
 *   llm_provider:     'ollama' | 'openai'
 *   openai_api_key:   raw secret (verlässt das Backend nie)
 *   openai_model:     z. B. 'gpt-4o' oder 'gpt-4o-mini'
 *   ollama_model:     z. B. 'llama3.2-vision:11b'
 */

const OpenAI = require('openai');

const DEFAULTS = {
  llm_provider: 'ollama',
  openai_api_key: '',
  openai_model: 'gpt-4o-mini',
  ollama_model: 'llama3.2-vision:11b',
};

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}

function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function getAllSettings(db) {
  return {
    llm_provider: getSetting(db, 'llm_provider'),
    openai_api_key: getSetting(db, 'openai_api_key'),
    openai_model: getSetting(db, 'openai_model'),
    ollama_model: getSetting(db, 'ollama_model'),
  };
}

/**
 * Returns `{ client, model }` based on current settings. Throws if the
 * configured provider isn't usable (e.g. OpenAI selected but no API key).
 */
function getLLMClient(db) {
  const provider = getSetting(db, 'llm_provider');

  if (provider === 'openai') {
    const apiKey = getSetting(db, 'openai_api_key');
    if (!apiKey) {
      const err = new Error('OpenAI provider is selected but no API key is configured. Please set one in Settings.');
      err.status = 400;
      throw err;
    }
    return {
      client: new OpenAI({ apiKey }),
      model: getSetting(db, 'openai_model'),
      provider: 'openai',
    };
  }

  // Default / fallback: Ollama via OpenAI-compatible API.
  return {
    client: new OpenAI({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama',
    }),
    model: getSetting(db, 'ollama_model'),
    provider: 'ollama',
  };
}

/**
 * Verifies that an OpenAI API key actually works by hitting the cheapest
 * auth-required endpoint (`/v1/models`, which only lists model IDs, no tokens
 * consumed). Resolves on success, rejects with a human-readable Error on failure.
 */
async function testOpenAIKey(apiKey) {
  const client = new OpenAI({ apiKey });
  try {
    await client.models.list();
  } catch (err) {
    // OpenAI SDK errors expose status + message; surface a clean message.
    const status = err?.status || err?.response?.status;
    if (status === 401) throw new Error('The API key is invalid or has been revoked.');
    if (status === 429) throw new Error('Rate limited — try again in a moment.');
    throw new Error(err?.message || 'Could not reach OpenAI to verify the key.');
  }
}

module.exports = { getLLMClient, getSetting, setSetting, getAllSettings, testOpenAIKey, DEFAULTS };

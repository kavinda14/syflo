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
  // Statischer Fallback = mittlere Sprosse der Empfehlungs-Leiter; die echte
  // Hardware-Empfehlung setzt das Modell, solange model_source 'auto' ist.
  ollama_model: 'qwen3.5:9b',
  // 'auto': die Maschinen-Empfehlung darf das Modell setzen.
  // 'manual': der Nutzer hat selbst gewählt — Automatik fasst nichts mehr an.
  model_source: 'auto',
  // Custom instructions (CONTEXT.md): Freitext des Nutzers, der jedem
  // Chat-System-Prompt mitgegeben wird. Der Schalter liegt als
  // 'true'/'false'-String in der TEXT-Spalte der settings-Tabelle.
  custom_instructions: '',
  custom_instructions_enabled: 'true',
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
    model_source: getSetting(db, 'model_source'),
    custom_instructions: getSetting(db, 'custom_instructions'),
    custom_instructions_enabled: getSetting(db, 'custom_instructions_enabled'),
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

/**
 * Extra-Parameter für LLM-Aufrufe, die sofort antworten müssen (Definitionen,
 * Titel, Summaries): unterdrückt bei Ollama die Denk-Phase von Reasoning-
 * Modellen (/v1 übersetzt reasoning_effort 'none' → think off).
 */
function noThinkExtras(provider) {
  return provider === 'ollama' ? { reasoning_effort: 'none' } : {};
}

/**
 * Hält das Ollama-Modell (und damit den KV-Prefix-Cache mit dem eingelesenen
 * Paper) 1 h im Speicher. Der OpenAI-kompatible Endpoint ignoriert keep_alive
 * — nur die native API setzt die TTL; ein leerer Prompt lädt ohne zu
 * generieren (done_reason 'load'). Fehler sind nie fatal.
 */
async function extendOllamaKeepAlive(model) {
  try {
    await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', keep_alive: '1h' }),
    });
  } catch { /* Ollama nicht erreichbar — TTL bleibt einfach beim Default */ }
}

/**
 * Wie viel des geladenen Modells im GPU-Speicher liegt (native /api/ps:
 * size_vram vs. size). Teilweises CPU-Offloading (unter 100 %) ist der
 * häufigste Grund für unerklärlich langsame lokale Antworten — 10–20×
 * langsamer als vollständig auf der GPU. null, wenn das Modell (noch) nicht
 * geladen oder Ollama nicht erreichbar ist; Fehler sind nie fatal.
 */
async function getOllamaGpuResidency(model) {
  try {
    const r = await fetch('http://localhost:11434/api/ps');
    if (!r.ok) return null;
    const data = await r.json();
    const loaded = (data.models || []).find(m => m.name === model || m.model === model);
    if (!loaded || !loaded.size) return null;
    return {
      vramPercent: Math.round(((loaded.size_vram || 0) / loaded.size) * 100),
      sizeBytes: loaded.size,
      vramBytes: loaded.size_vram || 0,
    };
  } catch {
    return null;
  }
}

module.exports = { getLLMClient, getSetting, setSetting, getAllSettings, testOpenAIKey, noThinkExtras, extendOllamaKeepAlive, getOllamaGpuResidency, DEFAULTS };

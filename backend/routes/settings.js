/**
 * settings.js
 *
 * Globale Syflo-Einstellungen: Welcher LLM-Provider wird verwendet,
 * welches Modell, und (für OpenAI) der API-Key.
 *
 * Wichtig: Der API-Key verlässt das Backend nie. GET liefert nur
 * `openai_api_key_set: true|false`, damit das Frontend einen Status
 * anzeigen kann, ohne den Key sehen zu müssen.
 */

const express = require('express');
const { getAllSettings, setSetting, testOpenAIKey } = require('../llm');

const ALLOWED_PROVIDERS = new Set(['ollama', 'openai']);

function buildResponse(db) {
  const s = getAllSettings(db);
  return {
    llm_provider: s.llm_provider,
    openai_model: s.openai_model,
    ollama_model: s.ollama_model,
    openai_api_key_set: Boolean(s.openai_api_key),
  };
}

module.exports = (db) => {
  const router = express.Router();

  // GET /api/settings — aktuelle Einstellungen (ohne den Klartext-API-Key)
  router.get('/', (_req, res) => {
    res.json(buildResponse(db));
  });

  // GET /api/settings/ollama-models — proxy to the local Ollama daemon to list
  // models the user has actually pulled. Lets the frontend show a dropdown
  // instead of asking the user to type an exact model tag.
  router.get('/ollama-models', async (_req, res) => {
    try {
      const r = await fetch('http://localhost:11434/api/tags');
      if (!r.ok) {
        return res.status(502).json({ error: `Ollama responded with status ${r.status}` });
      }
      const data = await r.json();
      const models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        parameter_size: m.details?.parameter_size,
      }));
      res.json({ models });
    } catch (err) {
      // Most common case: Ollama isn't running. Surface that distinctly so the
      // frontend can fall back to a free-text input.
      res.status(503).json({ error: 'Could not reach Ollama at localhost:11434. Is it running?' });
    }
  });

  // PUT /api/settings — partielles Update. Felder, die nicht im Body
  // stehen, bleiben unverändert. Leerer String beim API-Key löscht ihn.
  // Wenn ein neuer OpenAI-Key gesetzt wird (nicht leerer String), wird er
  // gegen die OpenAI-API validiert, bevor er gespeichert wird — damit das
  // Frontend sofort weiß, ob der Key tatsächlich funktioniert.
  router.put('/', async (req, res) => {
    const { llm_provider, openai_api_key, openai_model, ollama_model } = req.body;

    if (llm_provider !== undefined && !ALLOWED_PROVIDERS.has(llm_provider)) {
      return res.status(400).json({ error: `llm_provider must be one of: ${[...ALLOWED_PROVIDERS].join(', ')}` });
    }

    // Validate the key *before* persisting so an invalid one doesn't end up in the DB.
    if (typeof openai_api_key === 'string' && openai_api_key.length > 0) {
      try {
        await testOpenAIKey(openai_api_key);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (llm_provider !== undefined) setSetting(db, 'llm_provider', llm_provider);
    if (openai_api_key !== undefined) setSetting(db, 'openai_api_key', openai_api_key);
    if (openai_model !== undefined) setSetting(db, 'openai_model', openai_model);
    if (ollama_model !== undefined) setSetting(db, 'ollama_model', ollama_model);

    res.json(buildResponse(db));
  });

  return router;
};

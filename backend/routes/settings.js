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
const { getAllSettings, getSetting, setSetting, testOpenAIKey } = require('../llm');
const { recommendModel, systemFacts } = require('../hardware');

const ALLOWED_PROVIDERS = new Set(['ollama', 'openai']);

// Deckel für die Custom instructions: sie zehren vom RESERVED_TOKENS-Puffer
// (ancestor-context.js) — ~570 Tokens bei 2000 Zeichen lassen genug Luft für
// Tool-Definitionen, Historie und die Antwort selbst.
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 2000;

function buildResponse(db) {
  const s = getAllSettings(db);
  return {
    llm_provider: s.llm_provider,
    openai_model: s.openai_model,
    ollama_model: s.ollama_model,
    model_source: s.model_source,
    openai_api_key_set: Boolean(s.openai_api_key),
    custom_instructions: s.custom_instructions,
    custom_instructions_enabled: s.custom_instructions_enabled === 'true',
  };
}

module.exports = (db, options = {}) => {
  const router = express.Router();

  // POST /api/settings/apply-recommended — setzt das Hardware-empfohlene
  // Modell als aktives Modell, aber nur wenn (a) der Nutzer nie manuell
  // gewählt hat (model_source 'auto') und (b) das Modell installiert ist.
  // Das Frontend ruft das beim Start auf; Download-Gate bleibt gewahrt.
  router.post('/apply-recommended', async (_req, res) => {
    const { totalMemGb, platform } = systemFacts(options.system);
    const model = recommendModel(totalMemGb, platform);

    if (getSetting(db, 'model_source') !== 'auto') {
      return res.json({ applied: false, model, reason: 'manual choice wins' });
    }
    try {
      const r = await fetch('http://localhost:11434/api/tags');
      if (!r.ok) return res.json({ applied: false, model, reason: 'ollama unreachable' });
      const installed = ((await r.json()).models || []).some((m) => m.name === model);
      if (!installed) return res.json({ applied: false, model, reason: 'not installed' });
    } catch {
      return res.json({ applied: false, model, reason: 'ollama unreachable' });
    }

    setSetting(db, 'ollama_model', model); // model_source bleibt 'auto'
    res.json({ applied: true, model });
  });

  // GET /api/settings — aktuelle Einstellungen (ohne den Klartext-API-Key)
  router.get('/', (_req, res) => {
    res.json(buildResponse(db));
  });

  // GET /api/settings/ollama-models — proxy to the local Ollama daemon to list
  // models the user has actually pulled. Only vision-capable models are
  // returned (Syflo sends image attachments — a text-only model would fail
  // silently); `canThink` tells the frontend whether to offer the Thinking
  // toggle. Capabilities come from POST /api/show per model.
  router.get('/ollama-models', async (_req, res) => {
    try {
      const r = await fetch('http://localhost:11434/api/tags');
      if (!r.ok) {
        return res.status(502).json({ error: `Ollama responded with status ${r.status}` });
      }
      const data = await r.json();
      const withCaps = await Promise.all(
        (data.models || []).map(async (m) => {
          let capabilities = [];
          try {
            const s = await fetch('http://localhost:11434/api/show', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: m.name }),
            });
            if (s.ok) capabilities = (await s.json()).capabilities || [];
          } catch {
            // Ein einzelnes kaputtes Modell blockiert nicht die ganze Liste.
          }
          return { model: m, capabilities };
        })
      );
      const models = withCaps
        .filter(({ capabilities }) => capabilities.includes('vision'))
        .map(({ model: m, capabilities }) => ({
          name: m.name,
          size: m.size,
          parameter_size: m.details?.parameter_size,
          canThink: capabilities.includes('thinking'),
        }));
      res.json({ models });
    } catch (err) {
      // Most common case: Ollama isn't running. Surface that distinctly so the
      // frontend can fall back to a free-text input.
      res.status(503).json({ error: 'Could not reach Ollama at localhost:11434. Is it running?' });
    }
  });

  // POST /api/settings/ollama-pull — lädt ein Modell über den lokalen Ollama-
  // Daemon herunter und streamt dessen Fortschritts-Zeilen (NDJSON) 1:1 an
  // den Client durch, damit die Settings-Bibliothek einen Balken zeigen kann.
  router.post('/ollama-pull', async (req, res) => {
    const { model } = req.body;
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'model is required' });
    }
    try {
      const r = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!r.ok) {
        return res.status(502).json({ error: `Ollama responded with status ${r.status}` });
      }
      res.setHeader('Content-Type', 'application/x-ndjson');
      for await (const chunk of r.body) {
        res.write(chunk);
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Could not reach Ollama at localhost:11434. Is it running?' });
      } else {
        res.end();
      }
    }
  });

  // DELETE /api/settings/ollama-models/:name — entfernt ein installiertes
  // Modell (Settings-Bibliothek; der Picker kann nur wechseln, nie löschen).
  router.delete('/ollama-models/:name', async (req, res) => {
    try {
      const r = await fetch('http://localhost:11434/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: req.params.name }),
      });
      if (!r.ok) {
        return res.status(502).json({ error: `Ollama responded with status ${r.status}` });
      }
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: 'Could not reach Ollama at localhost:11434. Is it running?' });
    }
  });

  // PUT /api/settings — partielles Update. Felder, die nicht im Body
  // stehen, bleiben unverändert. Leerer String beim API-Key löscht ihn.
  // Wenn ein neuer OpenAI-Key gesetzt wird (nicht leerer String), wird er
  // gegen die OpenAI-API validiert, bevor er gespeichert wird — damit das
  // Frontend sofort weiß, ob der Key tatsächlich funktioniert.
  router.put('/', async (req, res) => {
    const { llm_provider, openai_api_key, openai_model, ollama_model, custom_instructions, custom_instructions_enabled } = req.body;

    if (llm_provider !== undefined && !ALLOWED_PROVIDERS.has(llm_provider)) {
      return res.status(400).json({ error: `llm_provider must be one of: ${[...ALLOWED_PROVIDERS].join(', ')}` });
    }

    if (custom_instructions !== undefined) {
      if (typeof custom_instructions !== 'string') {
        return res.status(400).json({ error: 'custom_instructions must be a string' });
      }
      if (custom_instructions.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
        return res.status(400).json({ error: `custom_instructions must be at most ${MAX_CUSTOM_INSTRUCTIONS_CHARS} characters` });
      }
    }
    if (custom_instructions_enabled !== undefined && typeof custom_instructions_enabled !== 'boolean') {
      return res.status(400).json({ error: 'custom_instructions_enabled must be a boolean' });
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
    if (custom_instructions !== undefined) setSetting(db, 'custom_instructions', custom_instructions);
    if (custom_instructions_enabled !== undefined) {
      // TEXT-Spalte — Boolean als 'true'/'false'-String ablegen.
      setSetting(db, 'custom_instructions_enabled', custom_instructions_enabled ? 'true' : 'false');
    }
    if (openai_api_key !== undefined) setSetting(db, 'openai_api_key', openai_api_key);
    if (openai_model !== undefined) setSetting(db, 'openai_model', openai_model);
    if (ollama_model !== undefined) {
      setSetting(db, 'ollama_model', ollama_model);
      // Eine Wahl über PUT ist immer eine Nutzer-Entscheidung — ab jetzt
      // fasst die Hardware-Automatik das Modell nicht mehr an.
      setSetting(db, 'model_source', 'manual');
    }

    res.json(buildResponse(db));
  });

  return router;
};

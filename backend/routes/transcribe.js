/**
 * routes/transcribe.js
 *
 * POST /api/transcribe — nimmt ein WAV (audio/wav, roher Body) entgegen und
 * antwortet mit { text }. Die eigentliche Erkennung macht der lazy
 * gestartete lokale whisper-server (siehe whisper.js, ADR-0004).
 *
 * options.manager ist für Tests injizierbar (gleiches Muster wie
 * options.system / options.messages in server.js).
 */

const express = require('express');
const { createWhisperManager, WhisperSetupError } = require('../whisper');

module.exports = (options = {}) => {
  const router = express.Router();
  const manager = options.manager || createWhisperManager();

  // 2 Minuten Diktat bei 16 kHz mono 16-bit ≈ 4 MB — 50 MB ist großzügig.
  router.post('/', express.raw({ type: 'audio/wav', limit: '50mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Expected a non-empty audio/wav body' });
    }
    try {
      const text = await manager.transcribe(req.body);
      res.json({ text });
    } catch (err) {
      if (err instanceof WhisperSetupError) {
        return res.status(503).json({ error: err.message });
      }
      console.error('[transcribe]', err.message);
      res.status(502).json({ error: `Transcription failed: ${err.message}` });
    }
  });

  return router;
};

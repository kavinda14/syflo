/**
 * routes/system.js — Hardware-Fakten und Modell-Empfehlung fürs Frontend.
 *
 * GET /api/system/recommendation
 *   → { platform, totalMemGb, recommendedModel }
 *
 * Leiter und Plattform-Regel leben in ../hardware.js; `system` ist
 * injizierbar (Tests).
 */

const express = require('express');
const { recommendModel, systemFacts } = require('../hardware');

module.exports = (system = {}) => {
  const router = express.Router();

  router.get('/recommendation', (_req, res) => {
    const { totalMemGb, platform } = systemFacts(system);
    res.json({
      platform,
      totalMemGb,
      recommendedModel: recommendModel(totalMemGb, platform),
    });
  });

  return router;
};

/**
 * hardware.js — Maschinen-Fakten und die Modell-Empfehlungs-Leiter.
 *
 * Die Leiter (design/mockup-model-picker.html, Sektion 03):
 *   < 16 GB   → qwen3.5:4b
 *   16–32 GB  → qwen3.5:9b
 *   > 32 GB   → gemma4:26b
 *
 * Auf Apple Silicon ist RAM = Grafikspeicher (unified memory). Auf anderen
 * Plattformen entscheidet eigentlich der GPU-VRAM; solange wir den nicht
 * erkennen, stufen wir eine Sprosse konservativer ein (Modell halb auf der
 * CPU wäre 10–20× langsamer als eine Sprosse kleiner ganz auf der GPU).
 */

const os = require('os');

const LADDER = ['qwen3.5:4b', 'qwen3.5:9b', 'gemma4:26b'];

function recommendModel(totalMemGb, platform) {
  let rung;
  if (totalMemGb < 16) rung = 0;
  else if (totalMemGb <= 32) rung = 1;
  else rung = 2;
  if (platform !== 'darwin') rung = Math.max(0, rung - 1);
  return LADDER[rung];
}

// `system` ist injizierbar (Tests); Default sind die echten os-Werte.
function systemFacts(system = {}) {
  const totalmem = system.totalmem || os.totalmem;
  const platform = system.platform || (() => process.platform);
  return {
    totalMemGb: Math.round(totalmem() / (1024 * 1024 * 1024)),
    platform: platform(),
  };
}

module.exports = { recommendModel, systemFacts };

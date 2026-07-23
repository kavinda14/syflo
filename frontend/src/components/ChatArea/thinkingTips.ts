/**
 * thinkingTips.ts — die kuratierten Syflo-Tipps für die Denk-Phase-Rotation
 * (design/mockup-model-picker.html, Sektion 04).
 *
 * Grill 2026-07-22 (memory: project-syflo-quotes-pool): Die Zitate leben
 * jetzt in quotes.json (~1500, quotable-Datensatz bereinigt + handkuratierte
 * Ergänzung) und rotieren über thinkingFeed.ts — 50/50-Münzwurf pro Zeile,
 * aktiver 50er-Pool, Ausmusterung nach 3 Anzeigen. Weiterhin gilt: KEINE
 * Online-API, keine LLM-generierten Zitate.
 *
 * Tipps beschreiben NUR echte Alleinstellungsmerkmale von Syflo — keine
 * generischen Bedien-Hinweise (Nutzerentscheid, Tipp-Wiederholung ist ok).
 */

export interface ThinkingLine {
  kind: 'tip' | 'quote';
  text: string;
  // Nur bei Zitaten: Autor:in.
  cite?: string;
}

export const TIPS: string[] = [
  'Right-click any word to branch into a new chat — the tree keeps every thread organized.',
  "Branches inherit their parent's conversation — every child chat knows where it came from.",
  'Mix local open-source models with frontier-lab models — switch anytime from the composer.',
  'Syflo is fully local by default — your chats, PDFs and even web searches never leave this machine.',
  'Highlight a paper in five colors and branch a conversation from any passage.',
  'Search arXiv and OpenAlex from inside Syflo and attach a paper straight to your tree.',
  'Switch to the mind-map view to see your whole conversation tree on one canvas.',
  'The highlights drawer collects every highlighted passage in the tree — click one to jump back to it.',
  'Open the parent-context pane on a child chat to see exactly what it inherited.',
  "Themes change more than colors — try Hyrule for a phosphor-glow thinking indicator.",
];

// Wechsel-Intervall der Rotation.
export const THINKING_LINE_INTERVAL_MS = 7000;

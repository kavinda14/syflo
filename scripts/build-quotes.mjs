/**
 * build-quotes.mjs — einmaliges Kurations-Skript für den Zitate-Pool des
 * ThinkingIndicator (Grill 2026-07-22, memory: project-syflo-quotes-pool).
 *
 * Quelle: quotable-Datensatz (MIT-Lizenz, github.com/quotable-io/data).
 * Pipeline: Download → Tag-Ausschlussliste → max. 120 Zeichen →
 * Fehlzuschreibungs-Blockliste (Quote-Investigator-Klassiker) →
 * Review-Blockliste (quotes-blocklist.json, Review 2026-07-22: PG,
 * wirklich berühmte Autoren, grundlegende Wahrheiten) →
 * handkuratierte Ergänzung (Athleten/Unternehmer/Künstler/Spirituelle) →
 * Dedup → frontend/src/components/ChatArea/quotes.json
 *
 * Aufruf:  node scripts/build-quotes.mjs
 * Läuft NUR zur Build-Zeit auf dem Entwicklungsrechner — die App selbst
 * bleibt vollständig offline (die JSON wird eingecheckt).
 *
 * ─── KURATIONS-REGELN (Review 2026-07-22 — gelten für JEDES neue Zitat, ───
 * ─── auch für Ergänzungen in SUPPLEMENT) ──────────────────────────────────
 * 1. WIRKLICH BERÜHMTE MENSCHEN: Der Name muss einer gebildeten Person
 *    plausibel bekannt sein (kanonische Philosophen, Wissenschaftler,
 *    Staatsleute, große Künstler/Autoren, Sport-Legenden, bekannte
 *    Unternehmer, anerkannte spirituelle Lehrer). Keine Kolumnisten,
 *    zweitklassigen Motivationsredner, obskuren Geistlichen. Untragbar
 *    unabhängig von Bekanntheit: Diktatoren/Massenmörder (z. B. Stalin),
 *    Personen mit Missbrauchs-/Gewalt-Skandalen (z. B. Sai Baba, Woody
 *    Allen, Joe Paterno).
 * 2. GRUNDLEGENDE WAHRHEITEN: zeitlose Einsichten über Leben, Lernen,
 *    Charakter, Arbeit. KEINE Politik, KEIN Konfessionelles/Gebete, KEIN
 *    Romantik-Kitsch, KEINE Sport-/Büro-Insider-Witze, KEINE
 *    Manifestations-Esoterik („intention creates reality").
 * 3. PG / JUGENDFREI: nichts Sexuelles oder Anzügliches, keine
 *    Gewalt-Pointen, kein Töten-Vokabular (auch nicht in
 *    Gewaltlosigkeits-Versen — zu schwer für eine Lade-Anzeige).
 *    Mildes „hell/damn" ist okay.
 * 4. KEINE FEHLZUSCHREIBUNGEN: bei bekannten Aphorismen zuerst Quote
 *    Investigator (quoteinvestigator.com) prüfen; im Zweifel weglassen.
 * 5. Entfernte Zitate/Autoren stehen in scripts/quotes-blocklist.json und
 *    bleiben bei jedem Rebuild draußen — Neuzugänge dort NIE löschen.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/quotable-io/data/master/data/quotes.json';

const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'frontend/src/components/ChatArea/quotes.json',
);

// Zeile muss in die schmale Rotations-UI passen (Grill: max. ~120 Zeichen).
const MAX_LENGTH = 120;

// Ausschluss statt Allowlist: die quotable-Tags sind grob, „Famous Quotes"
// ist ein Sammelbecken — eine Allowlist würde den Pool auf ~600 eindampfen.
// Raus fliegt, was laut Grill keine „grundlegende Wahrheit" ist:
// Politik, Konfessionelles, Humor, Tagesaktuelles, Sentimentales.
const EXCLUDED_TAGS = new Set([
  'Politics',
  'Religion',
  'Faith',
  'Humorous',
  'Film',
  'War',
  'Conservative',
  'Social Justice',
  'Love',
  'Friendship',
  'Technology',
  'Motivational',
  'Self Help',
  'History',
]);

// Bekannte Fehlzuschreibungen (Quote Investigator / Fake-Buddha-Quotes) —
// Substring-Match auf dem normalisierten Zitattext.
const MISATTRIBUTION_BLOCKLIST = [
  'be the change',                       // „Gandhi"
  'everybody is a genius',               // „Einstein"
  'definition of insanity',              // „Einstein"
  'over and over again and expecting',   // „Einstein", Insanity-Variante
  'not the strongest of the species',    // „Darwin"
  'great minds discuss ideas',           // „Eleanor Roosevelt"
  "if you can't explain it simply",      // „Einstein"
  'the mind is everything',              // „Buddha"
  'what you think, you become',          // „Buddha"
  'peace comes from within',             // „Buddha"
  'holding on to anger',                 // „Buddha"
  'success is not final, failure is not fatal', // „Churchill"
  'everything should be made as simple as possible', // „Einstein"
  'i am still learning',                 // „Michelangelo"
  'simplicity is the ultimate sophistication',  // „da Vinci"
  'the only thing necessary for the triumph of evil', // „Burke"
  'first they ignore you',               // „Gandhi"
  'best time to plant a tree',           // „chinesisches Sprichwort"
  'mark of an educated mind',            // „Aristoteles" (Durant)
  'we are what we repeatedly do',        // „Aristoteles" (Durant)
  'those who were seen dancing',         // „Nietzsche"
  'two most important days in your life',// „Twain"
  'a lie can travel halfway around the world', // „Twain"
  'somewhere, something incredible is waiting', // „Sagan" (Begley)
];

// Handkuratierte Ergänzung: füllt die im Datensatz dünnen Bereiche
// (Athleten, Unternehmer, Künstler, Spirituelle) mit gut belegten Zitaten
// auf — weiche Auffüllung, keine harte Quote. Enthält auch die 5
// Bestandszitate aus thinkingTips.ts (werden gemerged, Dedup greift).
const SUPPLEMENT = [
  // ── Bestand aus thinkingTips.ts ──
  { text: 'The important thing is not to stop questioning.', cite: 'Albert Einstein' },
  { text: 'What I cannot create, I do not understand.', cite: 'Richard Feynman' },
  { text: 'If I have seen further, it is by standing on the shoulders of giants.', cite: 'Isaac Newton' },
  { text: 'While we teach, we learn.', cite: 'Seneca' },
  { text: "Real knowledge is to know the extent of one's ignorance.", cite: 'Confucius' },
  // ── Wissenschaftler ──
  { text: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.', cite: 'Richard Feynman' },
  { text: 'If you wish to make an apple pie from scratch, you must first invent the universe.', cite: 'Carl Sagan' },
  { text: 'Science is a way of thinking much more than it is a body of knowledge.', cite: 'Carl Sagan' },
  { text: 'Nothing in life is to be feared, it is only to be understood.', cite: 'Marie Curie' },
  { text: 'An expert is a person who has made all the mistakes that can be made in a very narrow field.', cite: 'Niels Bohr' },
  { text: 'I have not failed. I have just found ten thousand ways that will not work.', cite: 'Thomas Edison' },
  { text: 'The good thing about science is that it is true whether or not you believe in it.', cite: 'Neil deGrasse Tyson' },
  // ── Philosophen ──
  { text: 'The unexamined life is not worth living.', cite: 'Socrates' },
  { text: 'No man ever steps in the same river twice.', cite: 'Heraclitus' },
  { text: 'He who has a why to live can bear almost any how.', cite: 'Friedrich Nietzsche' },
  { text: 'We suffer more often in imagination than in reality.', cite: 'Seneca' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', cite: 'Seneca' },
  { text: 'You have power over your mind — not outside events. Realize this, and you will find strength.', cite: 'Marcus Aurelius' },
  { text: 'Waste no more time arguing about what a good man should be. Be one.', cite: 'Marcus Aurelius' },
  { text: 'It is not death that a man should fear, but never beginning to live.', cite: 'Marcus Aurelius' },
  { text: 'Man is not worried by real problems so much as by his imagined anxieties about real problems.', cite: 'Epictetus' },
  { text: 'It is impossible for a man to learn what he thinks he already knows.', cite: 'Epictetus' },
  { text: 'The obstacle on the path becomes the way.', cite: 'Marcus Aurelius' },
  // ── Spirituelle Lehrer ──
  { text: 'Knowing others is intelligence; knowing yourself is true wisdom.', cite: 'Lao Tzu' },
  { text: 'A journey of a thousand miles begins with a single step.', cite: 'Lao Tzu' },
  { text: 'Nature does not hurry, yet everything is accomplished.', cite: 'Lao Tzu' },
  { text: 'We are what we think. All that we are arises with our thoughts.', cite: 'Buddha, Dhammapada' },
  { text: 'Drop by drop is the water pot filled.', cite: 'Buddha, Dhammapada' },
  { text: 'What you seek is seeking you.', cite: 'Rumi' },
  { text: 'Raise your words, not voice. It is rain that grows flowers, not thunder.', cite: 'Rumi' },
  { text: 'The wound is the place where the Light enters you.', cite: 'Rumi' },
  { text: 'When it is obvious that the goals cannot be reached, do not adjust the goals, adjust the action steps.', cite: 'Confucius' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', cite: 'Confucius' },
  // ── Athleten ──
  { text: "I can accept failure, everyone fails at something. But I can't accept not trying.", cite: 'Michael Jordan' },
  { text: 'You miss 100% of the shots you don’t take.', cite: 'Wayne Gretzky' },
  { text: "It ain't over till it's over.", cite: 'Yogi Berra' },
  { text: 'Champions keep playing until they get it right.', cite: 'Billie Jean King' },
  { text: 'Hard days are the best because that’s when champions are made.', cite: 'Gabby Douglas' },
  { text: 'The more I practice, the luckier I get.', cite: 'Gary Player' },
  { text: 'It’s the will to prepare to win that matters.', cite: 'Bear Bryant' },
  { text: 'Age is no barrier. It’s a limitation you put on your mind.', cite: 'Jackie Joyner-Kersee' },
  // ── Unternehmer ──
  { text: "Your time is limited, so don't waste it living someone else's life.", cite: 'Steve Jobs' },
  { text: 'Stay hungry, stay foolish.', cite: 'Steve Jobs' },
  { text: 'The best way to predict the future is to invent it.', cite: 'Alan Kay' },
  { text: "If you're not embarrassed by the first version of your product, you've launched too late.", cite: 'Reid Hoffman' },
  { text: 'Well done is better than well said.', cite: 'Benjamin Franklin' },
  { text: "Whether you think you can, or you think you can't — you're right.", cite: 'Henry Ford' },
  { text: 'Someone is sitting in the shade today because someone planted a tree a long time ago.', cite: 'Warren Buffett' },
  // ── Künstler ──
  { text: 'Every artist was first an amateur.', cite: 'Ralph Waldo Emerson' },
  { text: 'Art is a lie that makes us realize truth.', cite: 'Pablo Picasso' },
  { text: 'Inspiration exists, but it has to find you working.', cite: 'Pablo Picasso' },
  { text: 'Have no fear of perfection — you’ll never reach it.', cite: 'Salvador Dalí' },
  { text: 'Without craftsmanship, inspiration is a mere reed shaken in the wind.', cite: 'Johannes Brahms' },
  { text: 'If you hear a voice within you say “you cannot paint,” then by all means paint, and that voice will be silenced.', cite: 'Vincent van Gogh' },
];

const normalize = (s) =>
  s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

const isMisattributed = (text) => {
  const n = normalize(text);
  return MISATTRIBUTION_BLOCKLIST.some((frag) => n.includes(frag));
};

// Review-Blockliste (2026-07-22): Autoren exakt, Texte normalisiert-exakt.
const REVIEW_BLOCKLIST = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'quotes-blocklist.json'), 'utf8'),
);
const blockedAuthors = new Set(REVIEW_BLOCKLIST.authors);
const blockedTexts = new Set(REVIEW_BLOCKLIST.texts.map(normalize));

const isReviewBlocked = (text, author) =>
  blockedAuthors.has(author) || blockedTexts.has(normalize(text));

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
const raw = await res.json();

const stats = { source: raw.length, tagExcluded: 0, tooLong: 0, misattributed: 0, reviewBlocked: 0, deduped: 0 };
const seen = new Set();
const out = [];

const push = (text, cite) => {
  const key = normalize(text);
  if (seen.has(key)) {
    stats.deduped += 1;
    return;
  }
  seen.add(key);
  out.push({ text, cite });
};

// Ergänzung zuerst — bei Text-Kollisionen gewinnt die kuratierte Fassung.
for (const q of SUPPLEMENT) push(q.text, q.cite);

for (const q of raw) {
  if ((q.tags ?? []).some((t) => EXCLUDED_TAGS.has(t))) {
    stats.tagExcluded += 1;
    continue;
  }
  if (q.content.length > MAX_LENGTH) {
    stats.tooLong += 1;
    continue;
  }
  if (isMisattributed(q.content)) {
    stats.misattributed += 1;
    continue;
  }
  if (isReviewBlocked(q.content, q.author)) {
    stats.reviewBlocked += 1;
    continue;
  }
  push(q.content, q.author);
}

writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 1)}\n`);

console.log(`Quelle:              ${stats.source}`);
console.log(`Tag-Ausschluss:      -${stats.tagExcluded}`);
console.log(`Zu lang (>${MAX_LENGTH}):     -${stats.tooLong}`);
console.log(`Fehlzuschreibung:    -${stats.misattributed}`);
console.log(`Review-Blockliste:   -${stats.reviewBlocked}`);
console.log(`Duplikate:           -${stats.deduped}`);
console.log(`Ergänzung:           +${SUPPLEMENT.length}`);
console.log(`Gesamt:              ${out.length} → ${OUT_PATH}`);

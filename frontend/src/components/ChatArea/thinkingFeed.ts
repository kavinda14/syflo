/**
 * thinkingFeed.ts — liefert die rotierenden Zeilen für den ThinkingIndicator
 * (Grill 2026-07-22, memory: project-syflo-quotes-pool).
 *
 * Pro Zeile entscheidet ein 50/50-Münzwurf zwischen Tipp und Zitat.
 * Zitate zirkulieren in einem kleinen aktiven Pool: jedes wird ein paar Mal
 * gezeigt (Einpräg-Effekt), dann ausgemustert und durch ein frisches ersetzt,
 * bis alle einmal durch sind — dann beginnt der Zyklus neu.
 */

import { TIPS, type ThinkingLine } from './thinkingTips';

export interface Quote {
  text: string;
  cite: string;
}

export interface ThinkingFeed {
  next(): ThinkingLine;
  // Zitate kommen per Lazy-Import nach — bis dahin läuft der Feed mit Tipps.
  setQuotes(quotes: Quote[]): void;
}

// Stellschrauben (Grill 2026-07-22): Größe des aktiven Pools und wie oft
// ein Zitat gezeigt wird, bevor es ausgemustert wird.
export const ACTIVE_POOL_SIZE = 50;
export const QUOTE_SHOWS_BEFORE_RETIREMENT = 3;

interface FeedDeps {
  tips: string[];
  quotes: Quote[];
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  random?: () => number;
  poolSize?: number;
  showsPerQuote?: number;
}

interface PoolEntry {
  i: number; // Index in `quotes`
  n: number; // bisherige Anzeigen
}

interface PoolState {
  order: number[]; // gemischte Reihenfolge; `pos` trennt aktiviert von frisch
  pos: number;
  active: PoolEntry[];
}

// localStorage-Schlüssel des Zyklus-Zustands; v-Suffix für Format-Brüche.
export const FEED_STORAGE_KEY = 'syflo.thinkingFeed.v1';

export function createThinkingFeed({
  tips,
  quotes,
  storage,
  random = Math.random,
  poolSize = ACTIVE_POOL_SIZE,
  showsPerQuote = QUOTE_SHOWS_BEFORE_RETIREMENT,
}: FeedDeps): ThinkingFeed {
  let tipIndex = 0;
  let pool: PoolState | null = null;

  const loadPool = (): PoolState | null => {
    try {
      const raw = storage.getItem(FEED_STORAGE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw) as PoolState & { total: number };
      // Zitat-Indizes sind nur für genau diesen Datenstand gültig — bei
      // regeneriertem quotes.json beginnt der Zyklus neu.
      if (state.total !== quotes.length || state.active.length === 0) return null;
      return { order: state.order, pos: state.pos, active: state.active };
    } catch {
      return null;
    }
  };

  const savePool = (p: PoolState) => {
    try {
      storage.setItem(FEED_STORAGE_KEY, JSON.stringify({ ...p, total: quotes.length }));
    } catch {
      // Voller/gesperrter Speicher ist kein Grund, die Rotation anzuhalten.
    }
  };

  const shuffle = (n: number): number[] => {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const freshPool = (): PoolState => {
    const order = shuffle(quotes.length);
    const pos = Math.min(poolSize, order.length);
    return { order, pos, active: order.slice(0, pos).map(i => ({ i, n: 0 })) };
  };

  let lastQuoteIndex: number | null = null;

  const nextQuote = (): ThinkingLine => {
    if (!pool) pool = loadPool();
    if (!pool || pool.active.length === 0) pool = freshPool();
    // Dasselbe Zitat nie zweimal direkt hintereinander (sofern Auswahl da ist).
    const candidates =
      pool.active.length > 1 ? pool.active.filter(e => e.i !== lastQuoteIndex) : pool.active;
    const entry = candidates[Math.floor(random() * candidates.length)];
    lastQuoteIndex = entry.i;
    entry.n += 1;
    if (entry.n >= showsPerQuote) {
      pool.active = pool.active.filter(e => e !== entry);
      if (pool.pos < pool.order.length) {
        pool.active.push({ i: pool.order[pool.pos], n: 0 });
        pool.pos += 1;
      }
    }
    savePool(pool);
    const q = quotes[entry.i];
    return { kind: 'quote', text: q.text, cite: q.cite };
  };

  const nextTip = (): ThinkingLine => {
    const text = tips[tipIndex % tips.length];
    tipIndex += 1;
    return { kind: 'tip', text };
  };

  return {
    next(): ThinkingLine {
      // Solange die Zitate noch nicht geladen sind, tragen die Tipps allein.
      if (quotes.length === 0) return nextTip();
      return random() < 0.5 ? nextTip() : nextQuote();
    },
    setQuotes(next: Quote[]) {
      quotes = next;
      pool = null; // beim nächsten Zitat neu aus dem Speicher laden/aufbauen
    },
  };
}

// ── App-weiter Feed ──
// Ein Singleton, damit Anzeige-Zähler und Pool über alle Denk-Phasen hinweg
// gelten. Die ~1500 Zitate (≈250 KB) kommen per Lazy-Import: die erste
// Denk-Phase startet sofort mit Tipps, Zitate stoßen dazu, sobald der
// Chunk geladen ist — vollständig lokal, kein Netzwerk.
let sharedFeed: ThinkingFeed | null = null;

export function getThinkingFeed(): ThinkingFeed {
  if (!sharedFeed) {
    const feed = createThinkingFeed({ tips: TIPS, quotes: [], storage: window.localStorage });
    sharedFeed = feed;
    import('./quotes.json')
      .then(m => feed.setQuotes(m.default as Quote[]))
      .catch(() => {
        // Ohne Zitate rotieren die Tipps allein weiter.
      });
  }
  return sharedFeed;
}

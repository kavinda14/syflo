/**
 * arxiv.js
 *
 * Thin wrapper around arXiv's public Atom API (https://export.arxiv.org/api/query).
 * Used as Syflo's primary home-screen search backend because — unlike Semantic
 * Scholar — arXiv doesn't require an API key and is far more permissive about
 * rate-limiting, which means typing in the search bar Just Works™ instead of
 * dead-ending on a 429 after a minute.
 *
 * Shape contract
 * ──────────────
 * Results are mapped onto the existing `SearchResult` shape that the frontend
 * already renders (id, title, authors, year, citations, open_access_pdf_url,
 * abstract) so no UI changes are required. A few notes on the mapping:
 *
 *   - `id`          → the bare arXiv identifier (e.g. "2303.04137" or
 *                     "2303.04137v2"), so it's a stable key the frontend can
 *                     reuse if we ever round-trip back to arXiv.
 *   - `citations`   → 0 (arXiv doesn't expose citation counts; we enrich this
 *                     from Semantic Scholar later if the user imports).
 *   - `open_access_pdf_url` → always the canonical /pdf/ URL — every arXiv
 *                     paper is open access.
 *
 * Semantic Scholar enrichment (citations, field tags) is intentionally NOT
 * called during search. It only runs on import, where the cost of a single
 * SS request is acceptable.
 */

const { XMLParser } = require('fast-xml-parser');

// HTTPS, not HTTP — arXiv redirects every http://export.arxiv.org request with
// a 301 + empty body, and node-fetch's redirect-following sees a Content-Length
// of 0 and hands us back an empty feed. The result was a silent 0-hit search
// for every query.
const ARXIV_BASE = 'https://export.arxiv.org/api/query';

// Atom XML is small enough that we parse it eagerly. Attribute handling is
// important here — the <link> tags carry their target URL in href and their
// kind in title/rel, both as XML attributes.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Atom <author><name>X</name></author> structures should always come back as
  // arrays even if there's only one author. Same for <link> and <entry>.
  isArray: (tagName) => tagName === 'entry' || tagName === 'author' || tagName === 'link',
});

// Strip the "http(s)://arxiv.org/abs/" prefix from an arXiv entry id so we
// store the bare paper identifier (e.g. "2303.04137v2"). The Atom id field
// always looks like "http://arxiv.org/abs/2303.04137v2".
function extractArxivId(idUrl) {
  if (!idUrl) return null;
  const m = String(idUrl).match(/arxiv\.org\/abs\/(.+)$/i);
  return m ? m[1].trim() : idUrl;
}

// arXiv's <published> is an ISO 8601 timestamp like "2023-03-07T18:00:00Z".
// We surface just the year because that's all the UI shows.
function extractYear(published) {
  if (!published) return null;
  const m = String(published).match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

// Find the <link title="pdf"> entry's href among the link elements arXiv
// returns. Falls back to deriving the URL from the id if for some reason the
// PDF link is missing (rare but defensive).
function pickPdfLink(links, idUrl) {
  if (Array.isArray(links)) {
    const pdfLink = links.find((l) => l && l['@_title'] === 'pdf' && l['@_href']);
    if (pdfLink) return pdfLink['@_href'];
  }
  const id = extractArxivId(idUrl);
  return id ? `https://arxiv.org/pdf/${id}.pdf` : null;
}

// Normalize an arXiv entry into Syflo's SearchResult shape.
function shapeEntry(entry) {
  const id = extractArxivId(entry.id);
  const authorsRaw = Array.isArray(entry.author) ? entry.author : [];
  const authors = authorsRaw
    .map((a) => (a && typeof a.name === 'string' ? a.name.trim() : null))
    .filter(Boolean);
  // arXiv wraps the abstract in <summary> with awkward newlines; collapse them
  // so the search card body reads cleanly.
  const abstract = typeof entry.summary === 'string'
    ? entry.summary.replace(/\s+/g, ' ').trim()
    : null;
  return {
    id,
    title: typeof entry.title === 'string' ? entry.title.replace(/\s+/g, ' ').trim() : '',
    authors,
    year: extractYear(entry.published),
    citations: 0, // arXiv doesn't expose citation counts
    open_access_pdf_url: pickPdfLink(entry.link, entry.id),
    abstract,
  };
}

// Build the arXiv query URL. `scope` is either 'all' (full-text search across
// every field — what the user types) or 'ti' (title-only phrase search — used
// in parallel so that an exact title like "Attention Is All You Need" surfaces
// the canonical paper instead of every later derivative paper with the same
// suffix). Phrase-quote the query for ti: so multi-word titles match exactly.
function buildQueryUrl(query, limit, scope = 'all') {
  const term = scope === 'ti' ? `ti:"${query}"` : `${scope}:${query}`;
  const params = new URLSearchParams({
    search_query: term,
    start: '0',
    max_results: String(limit),
    sortBy: 'relevance',
    sortOrder: 'descending',
  });
  return `${ARXIV_BASE}?${params.toString()}`;
}

async function fetchEntries(url, fetchFn) {
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`arXiv search failed: ${res.status}`);
  }
  const xml = await res.text();
  const parsed = xmlParser.parse(xml);
  const entries = parsed?.feed?.entry;
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries.map(shapeEntry).filter((r) => r.title);
}

// Search arXiv. Returns { results, rate_limited: false } so the route can
// hand the envelope straight to the frontend.
//
// Strategy: fire a title-phrase query AND a full-text query in parallel,
// then merge with title-phrase hits first (deduped by arXiv id, version
// suffix ignored). The title-phrase pass is what guarantees that querying
// "Attention is all you need" returns Vaswani 2017 as the top result —
// arXiv's `all:` relevance ranking alone buries it under dozens of later
// papers with the same suffix in their title.
async function searchPapers(query, limit = 20, fetchFn = fetch) {
  const q = (query || '').toString().trim();
  if (!q) return { results: [], rate_limited: false };
  const cap = Math.max(1, Math.min(50, limit));

  const tiUrl = buildQueryUrl(q, cap, 'ti');
  const allUrl = buildQueryUrl(q, cap, 'all');
  // Title-phrase failures should never block the broader search — fall back
  // to all-fields-only if ti: throws (e.g. arXiv rejected the quoted form).
  const [tiSettled, allSettled] = await Promise.allSettled([
    fetchEntries(tiUrl, fetchFn),
    fetchEntries(allUrl, fetchFn),
  ]);
  const tiHits = tiSettled.status === 'fulfilled' ? tiSettled.value : [];
  if (allSettled.status === 'rejected') {
    if (tiSettled.status === 'fulfilled' && tiHits.length > 0) {
      return { results: tiHits.slice(0, cap), rate_limited: false };
    }
    throw allSettled.reason;
  }
  const allHits = allSettled.value;

  // Dedup by arXiv id stem (drop trailing "v2" etc.) so a paper appearing
  // in both passes shows up once. Title-phrase hits keep their position.
  const stem = (id) => String(id || '').replace(/v\d+$/i, '').toLowerCase();
  const seen = new Set();
  const merged = [];
  for (const r of [...tiHits, ...allHits]) {
    const key = stem(r.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
    if (merged.length >= cap) break;
  }
  return { results: merged, rate_limited: false };
}

module.exports = {
  searchPapers,
  // Exposed for tests / advanced callers — generally callers should use
  // searchPapers above.
  _internal: { shapeEntry, extractArxivId, extractYear, pickPdfLink, buildQueryUrl },
};

const ss = require('../semantic-scholar');

// Reset module-level caches between tests so cache hits from one test never
// silently satisfy another. clearCaches() is exposed for exactly this purpose.
beforeEach(() => {
  ss.clearCaches();
});

// Helper: make a fake `fetch` that responds with the given body for any URL,
// or returns a sequence of responses keyed by URL substring.
//
// A response body may declare `__status` to simulate a non-OK response, and
// `__headers` to expose response headers (e.g. Retry-After for 429 tests).
function makeFetch(routes) {
  return async (url) => {
    for (const [key, body] of Object.entries(routes)) {
      if (url.includes(key)) {
        if (typeof body === 'function') return body(url);
        if (body && typeof body === 'object' && '__status' in body) {
          const headerMap = new Map(
            Object.entries(body.__headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
          );
          return {
            ok: false,
            status: body.__status,
            headers: { get: (k) => headerMap.get(String(k).toLowerCase()) ?? null },
            async json() { return body.__body || {}; },
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          async json() { return body; },
        };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, async json() { return {}; } };
  };
}

describe('cleanTitleForSearch', () => {
  it('strips problematic punctuation and clips length', () => {
    const t = 'Diffusion Policy: Visuomotor Policy Learning (with Action Diffusion), 2023';
    expect(ss.cleanTitleForSearch(t)).toBe('Diffusion Policy  Visuomotor Policy Learning  with Action Diffusion   2023'.replace(/\s+/g, ' ').trim());
  });

  it('handles empty input', () => {
    expect(ss.cleanTitleForSearch('')).toBe('');
  });
});

describe('shapeFieldHierarchy', () => {
  it('returns nulls when no data', () => {
    expect(ss.shapeFieldHierarchy({})).toEqual({ field: null, subfield: null, topic: null, all: [] });
  });

  it('promotes first broad + specific items into three tiers', () => {
    const raw = {
      fieldsOfStudy: ['Computer Science'],
      s2FieldsOfStudy: [
        { category: 'Robotics', source: 's2-fos' },
        { category: 'Machine Learning', source: 's2-fos' },
      ],
    };
    const h = ss.shapeFieldHierarchy(raw);
    expect(h.field).toBe('Computer Science');
    expect(h.subfield).toBe('Robotics');
    expect(h.topic).toBe('Machine Learning');
    expect(h.all).toEqual(['Computer Science', 'Robotics', 'Machine Learning']);
  });

  it('deduplicates between broad and specific lists', () => {
    const raw = {
      fieldsOfStudy: ['Robotics'],
      s2FieldsOfStudy: [{ category: 'Robotics' }, { category: 'Imitation Learning' }],
    };
    const h = ss.shapeFieldHierarchy(raw);
    expect(h.all).toEqual(['Robotics', 'Imitation Learning']);
  });

  it('drops low-confidence s2FieldsOfStudy entries (score < 0.5)', () => {
    // Real S2 payloads include a per-tag classifier score. The low-score
    // entries are typically cross-domain noise ("Geodesy" on a robotics
    // paper because both mention "navigation").
    const raw = {
      fieldsOfStudy: ['Computer Science'],
      s2FieldsOfStudy: [
        { category: 'Robotics', score: 0.92 },
        { category: 'Machine Learning', score: 0.81 },
        { category: 'Geodesy', score: 0.18 }, // noise
        { category: 'Biology', score: 0.07 }, // noise
      ],
    };
    const h = ss.shapeFieldHierarchy(raw);
    expect(h.all).not.toContain('Geodesy');
    expect(h.all).not.toContain('Biology');
    expect(h.all).toContain('Robotics');
    expect(h.all).toContain('Machine Learning');
  });

  it('keeps s2FieldsOfStudy entries with no score (legacy dumps)', () => {
    const raw = {
      s2FieldsOfStudy: [
        { category: 'Robotics' }, // no score field at all
        { category: 'Imitation Learning' },
      ],
    };
    const h = ss.shapeFieldHierarchy(raw);
    expect(h.all).toContain('Robotics');
    expect(h.all).toContain('Imitation Learning');
  });
});

describe('shapeRecommendation', () => {
  it('extracts authors as names and tracks open-access status', () => {
    const r = ss.shapeRecommendation({
      paperId: 'abc',
      title: 'X',
      authors: [{ name: 'Alice' }, { name: 'Bob' }, { name: '' }],
      year: 2022,
      citationCount: 17,
      openAccessPdf: { url: 'https://example.com/x.pdf' },
      abstract: 'short abstract',
    });
    expect(r).toEqual({
      id: 'abc',
      title: 'X',
      authors: ['Alice', 'Bob'],
      year: 2022,
      citations: 17,
      open_access: true,
      abstract: 'short abstract',
    });
  });

  it('handles missing authors / openAccessPdf gracefully', () => {
    const r = ss.shapeRecommendation({ paperId: 'b', title: 'Y' });
    expect(r.authors).toEqual([]);
    expect(r.open_access).toBe(false);
    expect(r.year).toBeNull();
    expect(r.citations).toBe(0);
  });
});

describe('findPaperByTitle', () => {
  it('returns top match', async () => {
    const fetchFn = makeFetch({
      '/paper/search': { data: [{ paperId: 'p1', title: 'Diffusion Policy', authors: [], year: 2023 }] },
    });
    const r = await ss.findPaperByTitle('Diffusion Policy', fetchFn);
    expect(r.paperId).toBe('p1');
  });

  it('returns null when no matches', async () => {
    const fetchFn = makeFetch({ '/paper/search': { data: [] } });
    expect(await ss.findPaperByTitle('Nothing here', fetchFn)).toBeNull();
  });

  it('returns null for empty title without making a call', async () => {
    const fetchFn = jest.fn();
    expect(await ss.findPaperByTitle('   ', fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws on non-OK responses', async () => {
    const fetchFn = async () => ({ ok: false, status: 503, async json() { return {}; } });
    await expect(ss.findPaperByTitle('foo', fetchFn)).rejects.toThrow(/503/);
  });
});

describe('fetchRecommendations', () => {
  it('returns empty list on 404 (paper too new / obscure)', async () => {
    const fetchFn = async () => ({ ok: false, status: 404, async json() { return {}; } });
    const r = await ss.fetchRecommendations('p1', 4, fetchFn);
    expect(r.recommendedPapers).toEqual([]);
  });
});

describe('enrichFromTitle', () => {
  it('returns null when paper cannot be found', async () => {
    const fetchFn = makeFetch({ '/paper/search': { data: [] } });
    expect(await ss.enrichFromTitle('xx', { fetchFn })).toBeNull();
  });

  it('combines search + fields + recommendations into one shape', async () => {
    const fetchFn = makeFetch({
      '/paper/search': { data: [{ paperId: 'p1', title: 'Diffusion Policy', authors: [], year: 2023 }] },
      '/paper/p1?': {
        fieldsOfStudy: ['Computer Science'],
        s2FieldsOfStudy: [{ category: 'Robotics' }, { category: 'Imitation Learning' }],
      },
      '/paper/p1/recommendations': {
        recommendedPapers: [
          { paperId: 'r1', title: 'BC-RNN', authors: [{ name: 'Mandlekar' }], year: 2021, citationCount: 200, openAccessPdf: { url: 'x' } },
        ],
      },
    });

    const out = await ss.enrichFromTitle('Diffusion Policy', { fetchFn });
    expect(out).toMatchObject({
      ss_id: 'p1',
      fields: {
        field: 'Computer Science',
        subfield: 'Robotics',
        topic: 'Imitation Learning',
      },
    });
    expect(out.similar).toHaveLength(1);
    expect(out.similar[0]).toMatchObject({ id: 'r1', title: 'BC-RNN', citations: 200, open_access: true });
    expect(out.fetched_at).toBeDefined();
  });

  it('captures errors instead of throwing', async () => {
    const fetchFn = async () => { throw new Error('boom'); };
    const out = await ss.enrichFromTitle('whatever', { fetchFn });
    expect(out).toEqual({ error: 'boom' });
  });
});

describe('searchPapers caching + rate-limit handling', () => {
  it('caches identical queries for ~10 minutes (no second SS call)', async () => {
    const fetchFn = jest.fn(makeFetch({
      '/paper/search': {
        data: [
          { paperId: 'p1', title: 'Cached paper', authors: [{ name: 'A' }], year: 2024, citationCount: 1, openAccessPdf: null, abstract: null },
        ],
      },
    }));

    const a = await ss.searchPapers('diffusion policy', 8, fetchFn);
    const b = await ss.searchPapers('  Diffusion Policy  ', 8, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a.results).toHaveLength(1);
    expect(b.results).toHaveLength(1);
    expect(b.cached).toBe(true);
  });

  it('does not cache rate-limit responses (next call re-tries SS)', async () => {
    const fetchFn = jest.fn(makeFetch({
      '/paper/search': { __status: 429, __headers: { 'retry-after': '12' } },
    }));

    const a = await ss.searchPapers('throttle me', 8, fetchFn);
    const b = await ss.searchPapers('throttle me', 8, fetchFn);

    expect(a.rate_limited).toBe(true);
    expect(a.retry_after_seconds).toBe(12);
    expect(b.rate_limited).toBe(true);
    // Each call hit SS again (no cache stamping of error state).
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('omits retry_after_seconds when SS does not send Retry-After', async () => {
    const fetchFn = makeFetch({ '/paper/search': { __status: 429 } });
    const out = await ss.searchPapers('nope', 8, fetchFn);
    expect(out.rate_limited).toBe(true);
    expect(out.retry_after_seconds).toBeUndefined();
  });

  it('forwards SEMANTIC_SCHOLAR_API_KEY as x-api-key when set', async () => {
    const calls = [];
    const fetchFn = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return { data: [] }; },
      });
    };

    const original = process.env.SEMANTIC_SCHOLAR_API_KEY;
    process.env.SEMANTIC_SCHOLAR_API_KEY = 'ss-key-abc';
    try {
      await ss.searchPapers('something new', 8, fetchFn);
    } finally {
      if (original === undefined) delete process.env.SEMANTIC_SCHOLAR_API_KEY;
      else process.env.SEMANTIC_SCHOLAR_API_KEY = original;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.headers).toEqual({ 'x-api-key': 'ss-key-abc' });
  });

  it('omits x-api-key when no env var is set', async () => {
    const original = process.env.SEMANTIC_SCHOLAR_API_KEY;
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    const calls = [];
    const fetchFn = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return { data: [] }; },
      });
    };
    try {
      await ss.searchPapers('no api key here', 8, fetchFn);
    } finally {
      if (original !== undefined) process.env.SEMANTIC_SCHOLAR_API_KEY = original;
    }
    expect(calls).toHaveLength(1);
    // No second arg passed at all when there's no key — keeps the fetch
    // signature identical to before the API-key feature.
    expect(calls[0].init).toBeUndefined();
  });
});

describe('findPaperByTitle caching', () => {
  it('caches lookups for repeat titles within the TTL', async () => {
    const fetchFn = jest.fn(makeFetch({
      '/paper/search': {
        data: [{ paperId: 'p1', title: 'Diffusion Policy', authors: [], year: 2023 }],
      },
    }));

    await ss.findPaperByTitle('Diffusion Policy', fetchFn);
    await ss.findPaperByTitle('  diffusion policy  ', fetchFn);

    // Single underlying call despite two lookups + case/whitespace differences.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('parseRetryAfter', () => {
  function withHeaders(map) {
    const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
    return { headers: { get: (k) => lower.get(String(k).toLowerCase()) ?? null } };
  }

  it('parses an integer-seconds value', () => {
    expect(ss.parseRetryAfter(withHeaders({ 'retry-after': '15' }))).toBe(15);
  });

  it('parses an HTTP-date value', () => {
    const future = new Date(Date.now() + 30 * 1000).toUTCString();
    const secs = ss.parseRetryAfter(withHeaders({ 'retry-after': future }));
    expect(secs).toBeGreaterThanOrEqual(28);
    expect(secs).toBeLessThanOrEqual(31);
  });

  it('returns null when header missing', () => {
    expect(ss.parseRetryAfter(withHeaders({}))).toBeNull();
  });

  it('clamps absurdly large values to 600 seconds', () => {
    expect(ss.parseRetryAfter(withHeaders({ 'retry-after': '999999' }))).toBe(600);
  });
});

describe('extractArxivId', () => {
  it('finds modern arXiv ids in body text', () => {
    expect(ss.extractArxivId('preprint arXiv:1011.0686 published 2011')).toBe('1011.0686');
    expect(ss.extractArxivId('See arXiv: 2303.04137v2 for the latest.')).toBe('2303.04137v2');
  });

  it('finds legacy arXiv ids (subject/seqno)', () => {
    expect(ss.extractArxivId('Available as arXiv:hep-th/9901001')).toBe('hep-th/9901001');
  });

  it('returns null when no id is present', () => {
    expect(ss.extractArxivId('no identifier here')).toBeNull();
    expect(ss.extractArxivId('')).toBeNull();
    expect(ss.extractArxivId(null)).toBeNull();
  });
});

describe('extractDoi', () => {
  it('extracts a DOI from a doi.org URL', () => {
    expect(ss.extractDoi('Cite: https://doi.org/10.1109/CVPR.2017.123')).toBe('10.1109/CVPR.2017.123');
  });

  it('returns null when no DOI is present', () => {
    expect(ss.extractDoi('plain title text')).toBeNull();
  });

  it('strips trailing punctuation', () => {
    // Markdown often wraps the DOI in parens or appends a period.
    expect(ss.extractDoi('see 10.1109/CVPR.2017.123.')).toBe('10.1109/CVPR.2017.123');
  });
});

describe('titleSimilarity', () => {
  it('returns 1 for identical (post-normalization) titles', () => {
    expect(ss.titleSimilarity('A B C', 'a-b-c')).toBeCloseTo(1, 3);
  });

  it('returns a value < 0.5 for clearly different titles', () => {
    const s = ss.titleSimilarity(
      'A Reduction of Imitation Learning and Structured Prediction',
      'Diffusion Models for Image Generation',
    );
    expect(s).toBeLessThan(0.5);
  });
});

describe('lookupById', () => {
  it('hits the /paper/{idExpr} endpoint and returns the body', async () => {
    let seen;
    const fetchFn = async (url) => {
      seen = url;
      return { ok: true, status: 200, async json() { return { paperId: 'p9', title: 'Ross 2011' }; } };
    };
    const r = await ss.lookupById('arXiv:1011.0686', fetchFn);
    expect(r.paperId).toBe('p9');
    expect(seen).toMatch(/paper\/arXiv%3A1011\.0686/);
    expect(seen).toMatch(/fieldsOfStudy/);
  });

  it('returns null on 404', async () => {
    const fetchFn = async () => ({ ok: false, status: 404, async json() { return {}; } });
    expect(await ss.lookupById('arXiv:bogus', fetchFn)).toBeNull();
  });
});

describe('fetchRecommendations (multi-endpoint)', () => {
  it('prefers the dedicated /recommendations/v1 endpoint when available', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url.includes('/recommendations/v1/papers/forpaper/')) {
        return { ok: true, status: 200, async json() { return { recommendedPapers: [{ paperId: 'r1', title: 'X' }] }; } };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };
    const r = await ss.fetchRecommendations('p1', 4, fetchFn);
    expect(r.recommendedPapers).toHaveLength(1);
    expect(calls[0]).toMatch(/recommendations\/v1\/papers\/forpaper\/p1/);
  });

  it('falls back to the legacy /graph/v1/.../recommendations endpoint on 404', async () => {
    const fetchFn = async (url) => {
      if (url.includes('/recommendations/v1/')) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      if (url.includes('/paper/p1/recommendations')) {
        return { ok: true, status: 200, async json() { return { recommendedPapers: [{ paperId: 'leg1', title: 'L' }] }; } };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };
    const r = await ss.fetchRecommendations('p1', 4, fetchFn);
    expect(r.recommendedPapers[0].paperId).toBe('leg1');
  });
});

describe('enrichPaper (id-first resolution)', () => {
  it('prefers arXiv id lookup over title search when given', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url.includes('paper/arXiv')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              paperId: 'p9',
              title: 'A Reduction of Imitation Learning and Structured Prediction to No-Regret Online Learning',
              fieldsOfStudy: ['Computer Science'],
              s2FieldsOfStudy: [{ category: 'Machine Learning' }],
            };
          },
        };
      }
      if (url.includes('/recommendations/v1/')) {
        return { ok: true, status: 200, async json() { return { recommendedPapers: [{ paperId: 'r1', title: 'DAgger++' }] }; } };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };
    const out = await ss.enrichPaper({ title: 'irrelevant', arxivId: '1011.0686' }, { fetchFn });
    expect(out.ss_id).toBe('p9');
    expect(out.resolved_via).toBe('arxiv');
    expect(out.fields.field).toBe('Computer Science');
    expect(out.fields.subfield).toBe('Machine Learning');
    expect(out.similar).toHaveLength(1);
    // The title-search endpoint should not have been hit at all.
    expect(calls.some((u) => u.includes('/paper/search'))).toBe(false);
  });

  it('auto-extracts an arXiv id from the markdown body when not given', async () => {
    let lookupCalled = false;
    const fetchFn = async (url) => {
      if (url.includes('paper/arXiv')) {
        lookupCalled = true;
        return { ok: true, status: 200, async json() {
          return { paperId: 'p9', title: 'Ross 2011', fieldsOfStudy: ['CS'], s2FieldsOfStudy: [] };
        } };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };
    const md = '# Title\n\narXiv:1011.0686 — Ross et al.';
    const out = await ss.enrichPaper({ title: 'Ross 2011', markdown: md }, { fetchFn });
    expect(lookupCalled).toBe(true);
    expect(out.resolved_via).toBe('arxiv');
  });

  it('falls back to title search when arXiv lookup 404s', async () => {
    const fetchFn = async (url) => {
      if (url.includes('paper/arXiv')) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      if (url.includes('/paper/search')) {
        return { ok: true, status: 200, async json() {
          return { data: [{ paperId: 's1', title: 'My Paper', fieldsOfStudy: ['CS'], s2FieldsOfStudy: [] }] };
        } };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };
    const out = await ss.enrichPaper({ title: 'My Paper', arxivId: '9999.99999' }, { fetchFn });
    expect(out.ss_id).toBe('s1');
    expect(out.resolved_via).toBe('title');
  });

  it('uses fields-of-study search as a similar-papers fallback when recs return empty', async () => {
    const fetchFn = async (url) => {
      if (url.includes('paper/arXiv')) {
        return { ok: true, status: 200, async json() {
          return {
            paperId: 'p9',
            title: 'Imitation Learning Paper',
            fieldsOfStudy: ['Computer Science'],
            s2FieldsOfStudy: [{ category: 'Robotics' }],
          };
        } };
      }
      // Both recommendation endpoints return empty.
      if (url.includes('recommendations')) {
        return { ok: true, status: 200, async json() { return { recommendedPapers: [] }; } };
      }
      // Field-of-study search fallback fires here.
      if (url.includes('/paper/search')) {
        return { ok: true, status: 200, async json() {
          return { data: [
            // Seed itself — should be filtered out.
            { paperId: 'p9', title: 'Imitation Learning Paper' },
            { paperId: 'fb1', title: 'Related Robotics Work', authors: [{ name: 'A' }], year: 2020, citationCount: 50 },
          ] };
        } };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };
    const out = await ss.enrichPaper({ arxivId: '1011.0686' }, { fetchFn });
    expect(out.similar).toHaveLength(1);
    expect(out.similar[0].id).toBe('fb1');
  });
});

describe('shapeSsReference', () => {
  it('maps an SS citedPaper into the Syflo reference contract', () => {
    const cited = {
      paperId: 'ss-abc',
      title: 'A Reduction of Imitation Learning',
      authors: [{ name: 'Stéphane Ross' }, { name: 'Geoffrey Gordon' }, { name: 'J. Andrew Bagnell' }],
      year: 2011,
      externalIds: { DOI: '10.1234/EXAMPLE', ArXiv: '1011.0686' },
    };
    expect(ss.shapeSsReference(cited)).toEqual({
      id: 'ss-abc',
      title: 'A Reduction of Imitation Learning',
      authors: ['Stéphane Ross', 'Geoffrey Gordon', 'J. Andrew Bagnell'],
      year: 2011,
      // DOI is lowercased so dedup keys are symmetric with the OpenAlex shape.
      doi: '10.1234/example',
    });
  });

  it('returns null on a falsy input', () => {
    expect(ss.shapeSsReference(null)).toBeNull();
    expect(ss.shapeSsReference(undefined)).toBeNull();
  });

  it('handles missing optional fields without throwing', () => {
    const cited = { paperId: 's2', title: 'Bare Paper' };
    expect(ss.shapeSsReference(cited)).toEqual({
      id: 's2', title: 'Bare Paper', authors: [], year: null, doi: null,
    });
  });
});

describe('fetchReferencesFromSS', () => {
  // DAgger-shaped sample. Real SS returns this exact shape from
  //   /paper/DOI:.../references — verified against the live API.
  function makeDaggerRefs(n = 22) {
    return Array.from({ length: n }, (_, i) => ({
      citedPaper: {
        paperId: `ss-${i}`,
        title: `Reference ${i + 1}`,
        authors: [{ name: 'Author A' }, { name: 'Author B' }],
        year: 2000 + (i % 12),
        externalIds: { DOI: `10.1000/ref.${i}` },
      },
    }));
  }

  it('prefers DOI over arxivId and ssId when picking the identifier', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() { return { data: makeDaggerRefs(3) }; },
      };
    };
    const refs = await ss.fetchReferencesFromSS(
      { doi: '10.5555/Daggertype', arxivId: '1011.0686', ssId: 'CorpusId:99' },
      fetchFn,
    );
    expect(calls).toHaveLength(1);
    // DOI: prefix must show up URL-encoded (`:` → `%3A`).
    expect(calls[0]).toMatch(/paper\/DOI%3A10\.5555%2FDaggertype\/references/);
    expect(calls[0]).not.toMatch(/arXiv/);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ title: 'Reference 1', year: 2000 });
  });

  it('falls through to arxivId when no DOI is available', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() { return { data: makeDaggerRefs(2) }; },
      };
    };
    await ss.fetchReferencesFromSS({ arxivId: '1011.0686' }, fetchFn);
    expect(calls[0]).toMatch(/paper\/arXiv%3A1011\.0686\/references/);
  });

  it('uses ssId verbatim when neither DOI nor arxivId is given', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() { return { data: [] }; },
      };
    };
    await ss.fetchReferencesFromSS({ ssId: 'CorpusId:12345' }, fetchFn);
    // CorpusId:N is a valid SS id expression — encoded but not rewritten.
    expect(calls[0]).toMatch(/paper\/CorpusId%3A12345\/references/);
  });

  it('returns the full 22-ref list a DAgger lookup yields', async () => {
    const fetchFn = async () => ({
      ok: true, status: 200, headers: { get: () => null },
      async json() { return { data: makeDaggerRefs(22) }; },
    });
    const refs = await ss.fetchReferencesFromSS(
      { doi: '10.5555/example.dagger' },
      fetchFn,
    );
    expect(refs).toHaveLength(22);
    // First and last are shaped correctly.
    expect(refs[0]).toEqual({
      id: 'ss-0', title: 'Reference 1',
      authors: ['Author A', 'Author B'], year: 2000, doi: '10.1000/ref.0',
    });
    expect(refs[21].title).toBe('Reference 22');
  });

  it('returns [] (not null) when no identifier is supplied', async () => {
    const fetchFn = jest.fn();
    const refs = await ss.fetchReferencesFromSS({}, fetchFn);
    expect(refs).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns [] when SS responds with 404', async () => {
    const fetchFn = async () => ({
      ok: false, status: 404, headers: { get: () => null },
      async json() { return {}; },
    });
    const refs = await ss.fetchReferencesFromSS({ doi: '10.x/missing' }, fetchFn);
    expect(refs).toEqual([]);
  });

  it('retries with exponential backoff on 429 then succeeds', async () => {
    const sleeps = [];
    const sleepFn = (ms) => { sleeps.push(ms); return Promise.resolve(); };
    let attempt = 0;
    const fetchFn = async () => {
      attempt += 1;
      if (attempt < 3) {
        return {
          ok: false, status: 429,
          headers: { get: () => null },
          async json() { return {}; },
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() { return { data: makeDaggerRefs(1) }; },
      };
    };
    const refs = await ss.fetchReferencesFromSS(
      { doi: '10.x/y' },
      fetchFn,
      { sleepFn, baseBackoffMs: 100, maxRetries: 5 },
    );
    expect(refs).toHaveLength(1);
    // Two 429-driven sleeps before the third (successful) attempt.
    expect(sleeps).toEqual([100, 200]);
  });

  it('honours Retry-After (seconds) on 429', async () => {
    const sleeps = [];
    const sleepFn = (ms) => { sleeps.push(ms); return Promise.resolve(); };
    let attempt = 0;
    const fetchFn = async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          ok: false, status: 429,
          headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? '3' : null) },
          async json() { return {}; },
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        async json() { return { data: [] }; },
      };
    };
    await ss.fetchReferencesFromSS(
      { doi: '10.x/y' },
      fetchFn,
      { sleepFn, baseBackoffMs: 100 },
    );
    // 3 seconds == 3000 ms — Retry-After wins over the base backoff.
    expect(sleeps[0]).toBe(3000);
  });

  it('gives up after maxRetries consecutive 429s and returns []', async () => {
    const sleepFn = () => Promise.resolve();
    const fetchFn = jest.fn(async () => ({
      ok: false, status: 429, headers: { get: () => null },
      async json() { return {}; },
    }));
    const refs = await ss.fetchReferencesFromSS(
      { doi: '10.x/y' },
      fetchFn,
      { sleepFn, maxRetries: 2 },
    );
    expect(refs).toEqual([]);
    // 1 initial + 2 retries = 3 calls.
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('drops rows whose citedPaper is null or missing a title', async () => {
    const fetchFn = async () => ({
      ok: true, status: 200, headers: { get: () => null },
      async json() {
        return {
          data: [
            { citedPaper: { paperId: 'good', title: 'Real ref' } },
            { citedPaper: null },
            { citedPaper: { paperId: 'no-title' } },
            { /* missing citedPaper entirely */ },
          ],
        };
      },
    });
    const refs = await ss.fetchReferencesFromSS({ doi: '10.x/y' }, fetchFn);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe('good');
  });
});

const arxiv = require('../arxiv');

// Minimal Atom feed in the exact shape arXiv returns. Three entries: one with
// a versioned id + multiple authors, one with a single author, one minimal
// (no pdf link, to exercise the fallback).
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query: search_query=all:diffusion</title>
  <id>http://arxiv.org/api/query?search_query=all:diffusion</id>
  <entry>
    <id>http://arxiv.org/abs/2303.04137v2</id>
    <updated>2023-03-08T18:00:00Z</updated>
    <published>2023-03-07T18:00:00Z</published>
    <title>Diffusion Policy: Visuomotor Policy Learning via Action Diffusion</title>
    <summary>
      This paper introduces Diffusion Policy.
      A robot learns visuomotor skills.
    </summary>
    <author><name>Cheng Chi</name></author>
    <author><name>Zhenjia Xu</name></author>
    <author><name>Siyuan Feng</name></author>
    <link href="http://arxiv.org/abs/2303.04137v2" rel="alternate" type="text/html"/>
    <link title="pdf" rel="related" type="application/pdf" href="http://arxiv.org/pdf/2303.04137v2"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1706.03762</id>
    <updated>2017-12-06T18:00:00Z</updated>
    <published>2017-06-12T18:00:00Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are RNNs.</summary>
    <author><name>Ashish Vaswani</name></author>
    <link title="pdf" rel="related" type="application/pdf" href="http://arxiv.org/pdf/1706.03762"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/9999.99999</id>
    <published>2024-01-01T00:00:00Z</published>
    <title>No PDF Link Test</title>
    <summary>x</summary>
    <author><name>Solo Author</name></author>
    <link href="http://arxiv.org/abs/9999.99999" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

function fakeFetch(body, opts = {}) {
  return jest.fn(async () => ({
    ok: opts.ok !== false,
    status: opts.status || 200,
    async text() { return body; },
  }));
}

describe('arxiv.searchPapers', () => {
  it('returns empty results for an empty query without making a network call', async () => {
    const fetchFn = fakeFetch('');
    const out = await arxiv.searchPapers('  ', 20, fetchFn);
    expect(out).toEqual({ results: [], rate_limited: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('parses arXiv Atom XML into SearchResult shape', async () => {
    const fetchFn = fakeFetch(SAMPLE_FEED);
    const out = await arxiv.searchPapers('diffusion', 20, fetchFn);
    // Two parallel calls: title-phrase + all-fields. Same mock body for both.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(out.rate_limited).toBe(false);
    // Dedup by arXiv id stem collapses the duplicates from both passes.
    expect(out.results).toHaveLength(3);

    const [first, second, third] = out.results;
    expect(first).toMatchObject({
      id: '2303.04137v2',
      title: 'Diffusion Policy: Visuomotor Policy Learning via Action Diffusion',
      authors: ['Cheng Chi', 'Zhenjia Xu', 'Siyuan Feng'],
      year: 2023,
      citations: 0,
      open_access_pdf_url: 'http://arxiv.org/pdf/2303.04137v2',
    });
    expect(first.abstract).toMatch(/Diffusion Policy/);
    expect(second).toMatchObject({
      id: '1706.03762',
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani'],
      year: 2017,
    });
    // Missing <link title="pdf"> still produces a usable URL derived from id.
    expect(third.open_access_pdf_url).toBe('https://arxiv.org/pdf/9999.99999.pdf');
  });

  it('builds title-phrase + all-fields URLs in parallel', async () => {
    const fetchFn = fakeFetch(SAMPLE_FEED);
    await arxiv.searchPapers('attention is all you need', 12, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const urls = fetchFn.mock.calls.map((c) => c[0]);
    expect(urls.every((u) => u.includes('export.arxiv.org/api/query'))).toBe(true);
    expect(urls.every((u) => u.includes('max_results=12'))).toBe(true);
    expect(urls.every((u) => u.includes('sortBy=relevance'))).toBe(true);
    expect(urls.some((u) => u.includes('search_query=ti%3A%22attention'))).toBe(true);
    expect(urls.some((u) => u.includes('search_query=all%3Aattention'))).toBe(true);
  });

  it('caps max_results at 50 to keep payloads sane', async () => {
    const fetchFn = fakeFetch(SAMPLE_FEED);
    await arxiv.searchPapers('q', 9999, fetchFn);
    expect(fetchFn.mock.calls.every((c) => c[0].includes('max_results=50'))).toBe(true);
  });

  it('throws when arXiv responds non-OK so the route can fall back to SS', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 503,
      async text() { return ''; },
    }));
    await expect(arxiv.searchPapers('foo', 20, fetchFn)).rejects.toThrow(/503/);
  });

  it('falls back to title-phrase hits when the all-fields query fails', async () => {
    // First call (ti:) returns the sample feed; second (all:) errors out.
    let n = 0;
    const fetchFn = jest.fn(async () => {
      n += 1;
      if (n === 1) {
        return { ok: true, status: 200, async text() { return SAMPLE_FEED; } };
      }
      return { ok: false, status: 503, async text() { return ''; } };
    });
    const out = await arxiv.searchPapers('attention is all you need', 20, fetchFn);
    expect(out.rate_limited).toBe(false);
    expect(out.results.length).toBeGreaterThan(0);
  });

  it('returns empty results when arXiv returns a feed with no entries', async () => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query</title>
  <id>http://arxiv.org/api/query?q=zzz</id>
</feed>`;
    const fetchFn = fakeFetch(empty);
    const out = await arxiv.searchPapers('zzz', 20, fetchFn);
    expect(out).toEqual({ results: [], rate_limited: false });
  });
});

describe('arxiv internals', () => {
  const { extractArxivId, extractYear, pickPdfLink, buildQueryUrl } = arxiv._internal;

  it('extractArxivId strips the abs/ prefix', () => {
    expect(extractArxivId('http://arxiv.org/abs/2303.04137')).toBe('2303.04137');
    expect(extractArxivId('https://arxiv.org/abs/2303.04137v2')).toBe('2303.04137v2');
    expect(extractArxivId(null)).toBeNull();
  });

  it('extractYear pulls the 4-digit year from an ISO date', () => {
    expect(extractYear('2023-03-07T18:00:00Z')).toBe(2023);
    expect(extractYear(undefined)).toBeNull();
  });

  it('pickPdfLink prefers the title=pdf link, falls back to id-derived URL', () => {
    const links = [
      { '@_href': 'http://arxiv.org/abs/x', '@_rel': 'alternate' },
      { '@_href': 'http://arxiv.org/pdf/x', '@_title': 'pdf' },
    ];
    expect(pickPdfLink(links, 'http://arxiv.org/abs/x')).toBe('http://arxiv.org/pdf/x');
    expect(pickPdfLink(undefined, 'http://arxiv.org/abs/2303.0001')).toBe(
      'https://arxiv.org/pdf/2303.0001.pdf',
    );
  });

  it('buildQueryUrl encodes the query', () => {
    const url = buildQueryUrl('foo bar', 5);
    expect(url).toContain('search_query=all%3Afoo+bar');
    expect(url).toContain('max_results=5');
  });
});

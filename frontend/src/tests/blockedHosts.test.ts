import { describe, it, expect } from 'vitest';
import { isLikelyBlockedHost, allCandidatesBlocked } from '../components/PaperSearch/blockedHosts';

describe('isLikelyBlockedHost', () => {
  it('flags sagepub.com (Dec-MCTS lives here)', () => {
    expect(isLikelyBlockedHost('https://journals.sagepub.com/doi/pdf/10.1177/0278364918755924')).toBe(true);
  });

  it('flags every known publisher in the allowlist', () => {
    const blocked = [
      'https://www.sciencedirect.com/article/pii/S123/pdfft',
      'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=1',
      'https://link.springer.com/content/pdf/10.1007/abc.pdf',
      'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/x',
      'https://www.tandfonline.com/doi/pdf/10.1080/y',
    ];
    for (const url of blocked) expect(isLikelyBlockedHost(url)).toBe(true);
  });

  it('does not flag arXiv or institutional repos', () => {
    expect(isLikelyBlockedHost('https://arxiv.org/pdf/1706.03762.pdf')).toBe(false);
    expect(isLikelyBlockedHost('https://opus.lib.uts.edu.au/bitstream/.../paper.pdf')).toBe(false);
    expect(isLikelyBlockedHost('https://www.biorxiv.org/content/10.1101/x.full.pdf')).toBe(false);
  });

  it('handles malformed input defensively', () => {
    expect(isLikelyBlockedHost(null)).toBe(false);
    expect(isLikelyBlockedHost(undefined)).toBe(false);
    expect(isLikelyBlockedHost('')).toBe(false);
    expect(isLikelyBlockedHost('not-a-url')).toBe(false);
  });

  it('matches subdomains via suffix (journals.sagepub.com → sagepub.com)', () => {
    expect(isLikelyBlockedHost('https://anything.sagepub.com/p.pdf')).toBe(true);
  });

  it('does not match accidental substring (sagepub-mirror.org is not Sage)', () => {
    expect(isLikelyBlockedHost('https://sagepub-mirror.org/p.pdf')).toBe(false);
  });
});

describe('allCandidatesBlocked', () => {
  it('returns true when every URL in the list is blocked', () => {
    expect(allCandidatesBlocked(
      'https://journals.sagepub.com/x.pdf',
      ['https://www.sciencedirect.com/y.pdf'],
    )).toBe(true);
  });

  it('returns false when at least one mirror is on an importable host', () => {
    expect(allCandidatesBlocked(
      'https://journals.sagepub.com/x.pdf',
      ['https://arxiv.org/pdf/0000.0000.pdf'],
    )).toBe(false);
  });

  it('returns false when there is no URL at all', () => {
    expect(allCandidatesBlocked(null, [])).toBe(false);
    expect(allCandidatesBlocked(undefined, undefined)).toBe(false);
  });

  it('ignores nullish entries in the candidate list', () => {
    // The frontend filters these out before sending, but the helper should
    // also be robust to bad inputs.
    expect(allCandidatesBlocked(
      'https://journals.sagepub.com/x.pdf',
      [null as unknown as string, '', undefined as unknown as string],
    )).toBe(true);
  });
});

/**
 * blockedHosts.ts
 *
 * UX hint: a small allowlist of publisher hostnames whose direct-PDF endpoints
 * reliably 403 any non-browser fetch (no Referer chain, no cookies, no JS
 * challenge solved). When a search result's only candidate URL lives on one of
 * these hosts, the home screen swaps the Import button for an "Open DOI" link
 * — fewer dead-end clicks for the user.
 *
 * Scope discipline
 * ────────────────
 * We deliberately keep this list short and high-confidence. False positives
 * (treating an importable host as blocked) cost more than false negatives
 * (showing Import on a host that ends up 403ing — the backend's friendly
 * error message still covers that case). When in doubt, leave it off.
 *
 * Empirical basis: we hit each host with a browser-like User-Agent + Accept
 * header from a clean IP and confirmed the 403 (Sage, Elsevier, IEEE, Wiley,
 * Springer). bioRxiv / arXiv / PMC / institutional repos are NOT here because
 * they serve PDFs directly.
 *
 * Verify with: `curl -sI -A "Mozilla/5.0" <url>` — anything 403'ing without
 * an interactive session belongs here.
 */

// Suffix-matched against URL hostname (lowercased). "sagepub.com" matches
// both "journals.sagepub.com" and "www.sagepub.com" without needing a regex.
const BLOCKED_HOSTS: readonly string[] = [
  'sagepub.com',
  'sciencedirect.com', // Elsevier
  'ieeexplore.ieee.org',
  'link.springer.com',
  'onlinelibrary.wiley.com',
  'tandfonline.com', // Taylor & Francis
];

export function isLikelyBlockedHost(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return BLOCKED_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// True when EVERY known PDF candidate for a result is on a blocked host —
// i.e. there's no mirror the backend's fallback chain could try. Callers use
// this to decide whether to hide the Import button entirely. An empty
// candidate list means "no PDF" and is handled upstream, not here.
export function allCandidatesBlocked(
  primaryUrl: string | null | undefined,
  candidates: readonly string[] | undefined,
): boolean {
  const all = [primaryUrl, ...(candidates || [])].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  if (all.length === 0) return false;
  return all.every(isLikelyBlockedHost);
}

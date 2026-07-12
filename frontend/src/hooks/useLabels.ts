/**
 * hooks/useLabels.ts
 *
 * Global per-color labels for the highlight feature. Loaded once from the
 * backend on first mount, then shared across every consumer via a tiny
 * module-level cache + subscribe-pattern. When the user renames a label in
 * the FloatingPopup, every other open popup and the sidebar receive the new
 * name in the same render cycle.
 *
 * Mirrors the cache shape in useReferences.ts so the two hooks read the same
 * way and can be maintained together. Differences:
 *   - The data is a single object (not per-paper), so the cache is one slot.
 *   - We expose a setter (renameLabel) since labels are user-editable —
 *     useReferences is read-only.
 */

import { useEffect, useState } from 'react';
import { api } from '../api';
import { DEFAULT_HIGHLIGHT_LABELS } from '../types';
import type { HighlightColor, HighlightLabels } from '../types';

interface State {
  labels: HighlightLabels;
  loading: boolean;
  error: string | null;
}

// Module-level state. We deliberately don't put this in React context so the
// hook can be used from anywhere without wrapping providers (this is internal
// to the app, not a published library).
let cached: HighlightLabels | null = null;
let inFlight: Promise<HighlightLabels> | null = null;
const subscribers = new Set<(labels: HighlightLabels) => void>();

// Imperative reset for tests so each test starts from a clean cache. Not
// exported from the public hook API.
export function _resetLabelsCacheForTests() {
  cached = null;
  inFlight = null;
  subscribers.clear();
}

function broadcast(next: HighlightLabels) {
  cached = next;
  for (const fn of subscribers) fn(next);
}

async function fetchLabels(): Promise<HighlightLabels> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = api
    .getHighlightLabels()
    .then((labels) => {
      cached = { ...DEFAULT_HIGHLIGHT_LABELS, ...labels };
      inFlight = null;
      broadcast(cached);
      return cached;
    })
    .catch((err) => {
      inFlight = null;
      // Fall back to defaults if the backend is unreachable — the popup must
      // still render. The error is logged but not surfaced to the user; a
      // failed label fetch is a degraded experience, not a broken one.
      console.warn('useLabels: falling back to defaults', err);
      cached = { ...DEFAULT_HIGHLIGHT_LABELS };
      broadcast(cached);
      return cached;
    });
  return inFlight;
}

/**
 * Subscribe to the global labels. Returns the current value plus a renamer.
 *
 * The renamer fires the PUT *and* updates the cache optimistically so all
 * subscribers re-render before the server round-trip completes. If the server
 * rejects the change, we roll back to the previous value.
 */
export function useLabels(): State & {
  renameLabel: (color: HighlightColor, label: string) => Promise<void>;
} {
  const [labels, setLabels] = useState<HighlightLabels>(
    cached ?? DEFAULT_HIGHLIGHT_LABELS,
  );
  const [loading, setLoading] = useState<boolean>(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (cached === null) {
      fetchLabels().then(() => {
        if (active) setLoading(false);
      });
    } else {
      setLoading(false);
    }
    const update = (next: HighlightLabels) => {
      if (active) setLabels(next);
    };
    subscribers.add(update);
    return () => {
      active = false;
      subscribers.delete(update);
    };
  }, []);

  const renameLabel = async (color: HighlightColor, label: string) => {
    const previous = cached ?? { ...DEFAULT_HIGHLIGHT_LABELS };
    // Optimistic: broadcast the new value immediately so the inline input
    // commits without a flash of stale text.
    broadcast({ ...previous, [color]: label.trim() || DEFAULT_HIGHLIGHT_LABELS[color] });
    try {
      const result = await api.setHighlightLabel(color, label);
      // Server may have truncated / reset to default — broadcast the canonical
      // value so all subscribers agree with what's actually stored.
      broadcast({ ...(cached ?? previous), [color]: result.label });
      setError(null);
    } catch (err) {
      // Roll back. Tell the user nothing — a transient network failure
      // shouldn't pop a toast when the worst that happens is the rename
      // didn't stick.
      broadcast(previous);
      const message = err instanceof Error ? err.message : 'Failed to rename';
      setError(message);
      console.warn('useLabels: rename failed, rolled back', err);
    }
  };

  return { labels, loading, error, renameLabel };
}

/**
 * hooks/useTreeHighlights.ts
 *
 * Baum-weite Highlight-Liste für den Highlights-Drawer
 * (design/mockup-highlights-overview.html, Variante A). Gleiche Architektur
 * wie useLabels: Modul-Cache + Subscribe-Pattern statt React-Context, damit
 * der Hook von überall konsumierbar ist.
 *
 * Aktualität (Grill-Entscheidung 9): die CRUD-Hooks (useHighlights,
 * useChatHighlights) rufen nach jedem erfolgreichen Anlegen/Umfärben/Löschen
 * invalidateTreeHighlights() — der Drawer lädt dann neu und bleibt synchron,
 * ohne dass die Hooks voneinander wissen.
 *
 * Der Cache hält genau einen Baum (den zuletzt angefragten) — es ist immer
 * nur ein Baum gleichzeitig sichtbar, ein Mehr-Slot-Cache wäre totes Gewicht.
 */

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type { TreeHighlight } from '../types';

interface State {
  items: TreeHighlight[];
  loading: boolean;
  error: string | null;
}

let cachedKey: string | null = null;
let cachedItems: TreeHighlight[] | null = null;
const subscribers = new Set<(items: TreeHighlight[] | null) => void>();

// Imperativer Reset für Tests — analog _resetLabelsCacheForTests.
export function _resetTreeHighlightsCacheForTests() {
  cachedKey = null;
  cachedItems = null;
  subscribers.clear();
}

function broadcast(items: TreeHighlight[] | null) {
  cachedItems = items;
  for (const fn of subscribers) fn(items);
}

/**
 * Cache verwerfen und alle Subscriber mit `null` benachrichtigen — deren
 * Effekt lädt daraufhin neu. Von den CRUD-Hooks nach jeder erfolgreichen
 * Mutation aufgerufen; ohne offene Subscriber passiert nichts weiter als
 * das Verwerfen (der nächste Drawer-Öffner lädt ohnehin frisch).
 */
export function invalidateTreeHighlights() {
  broadcast(null);
}

export function useTreeHighlights(chatId: string | null): State & {
  refresh: () => void;
} {
  const [state, setState] = useState<State>(() => ({
    items: cachedKey === chatId && cachedItems ? cachedItems : [],
    loading: chatId !== null && !(cachedKey === chatId && cachedItems),
    error: null,
  }));

  const load = useCallback(() => {
    if (!chatId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .listTreeHighlights(chatId)
      .then((items) => {
        cachedKey = chatId;
        cachedItems = items;
        setState({ items, loading: false, error: null });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load tree highlights';
        setState({ items: [], loading: false, error: message });
      });
  }, [chatId]);

  useEffect(() => {
    if (!chatId) {
      setState({ items: [], loading: false, error: null });
      return;
    }
    if (cachedKey === chatId && cachedItems) {
      setState({ items: cachedItems, loading: false, error: null });
    } else {
      load();
    }
    // Invalidierung: `null` heißt "Cache verworfen → neu laden"; ein echtes
    // Array heißt "frische Daten eines parallelen Ladevorgangs übernehmen".
    const update = (items: TreeHighlight[] | null) => {
      if (items === null) load();
      else setState({ items, loading: false, error: null });
    };
    subscribers.add(update);
    return () => {
      subscribers.delete(update);
    };
  }, [chatId, load]);

  return { ...state, refresh: load };
}

/**
 * InheritedContextBanner.test.tsx
 *
 * Kontext-Banner in der Chat-Spalte (Variante 3a aus
 * design/mockup-context-banner-variants.html §01): Banner-Zeile mit
 * Vorfahren-Zahl, Inline-Akkordeon mit Kernaussage + Stichpunkten pro
 * Vorfahre, „literal text"-Klapper, Markdown+KaTeX-Fallback für alte
 * Summaries ohne display-Struktur.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InheritedContextBanner } from '../components/ChatArea/InheritedContextBanner';
import type { ChatAncestor } from '../types';

const ancestors: ChatAncestor[] = [
  {
    id: 'root',
    title: 'Neural ODE paper walkthrough',
    parent_word: null,
    summary: 'Continuous models solve $dS/dt = f(S, t)$ directly.',
    display: {
      gist: 'Neural ODEs model dynamics continuously.',
      points: ['**Core idea:** solve $dS/dt = f(S, t)$ directly.', '**No drift** over long horizons.'],
    },
  },
  {
    id: 'parent',
    title: 'Jemma architecture deep-dive',
    parent_word: 'Jemma',
    summary: 'Old-style plain summary with $dt$ inline math and *emphasis*.',
    display: null,
  },
];

describe('InheritedContextBanner', () => {
  it('rendert nichts ohne Vorfahren', () => {
    const { container } = render(<InheritedContextBanner ancestors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('zeigt die Banner-Zeile mit Vorfahren-Zahl, Akkordeon zu', () => {
    render(<InheritedContextBanner ancestors={ancestors} />);
    expect(screen.getByTestId('inherited-context-toggle')).toHaveTextContent(
      'Carries background from 2 earlier chats',
    );
    expect(screen.queryByTestId('inherited-context-body')).not.toBeInTheDocument();
  });

  it('klappt auf: Kernaussage + Stichpunkte pro Vorfahre, Fußzeile mit Kontrakt', () => {
    render(<InheritedContextBanner ancestors={ancestors} />);
    fireEvent.click(screen.getByTestId('inherited-context-toggle'));
    const body = screen.getByTestId('inherited-context-body');
    expect(body).toHaveTextContent('Neural ODEs model dynamics continuously.');
    expect(body).toHaveTextContent('No drift');
    expect(body).toHaveTextContent('Sent to the AI with every message in this chat.');
  });

  it('rendert Markdown+KaTeX statt roher $- und *-Zeichen (Fallback-Volltext)', () => {
    render(<InheritedContextBanner ancestors={ancestors} />);
    fireEvent.click(screen.getByTestId('inherited-context-toggle'));
    const parentCard = screen.getByTestId('inherited-card-parent');
    // Kein rohes "$dt$" — KaTeX hat die Formel übernommen …
    expect(parentCard.textContent).not.toContain('$dt$');
    expect(parentCard.querySelector('.katex')).not.toBeNull();
    // … und *emphasis* wurde zu <em> statt Sternchen im Text.
    expect(parentCard.textContent).not.toContain('*emphasis*');
    expect(parentCard.querySelector('em')).not.toBeNull();
  });

  it('zeigt den wörtlich geerbten Text erst nach Klick auf den literal-Toggle', () => {
    render(<InheritedContextBanner ancestors={ancestors} />);
    fireEvent.click(screen.getByTestId('inherited-context-toggle'));
    expect(screen.queryByTestId('inherited-card-root-literal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inherited-card-root-literal-toggle'));
    expect(screen.getByTestId('inherited-card-root-literal')).toHaveTextContent(
      'Continuous models solve',
    );
  });

  it('markiert den direkten Elternchat als wörtlich geerbt, ohne literal-Toggle', () => {
    render(<InheritedContextBanner ancestors={ancestors} />);
    fireEvent.click(screen.getByTestId('inherited-context-toggle'));
    const parentCard = screen.getByTestId('inherited-card-parent');
    expect(parentCard).toHaveTextContent('inherited word-for-word');
    expect(
      screen.queryByTestId('inherited-card-parent-literal-toggle'),
    ).not.toBeInTheDocument();
  });
});

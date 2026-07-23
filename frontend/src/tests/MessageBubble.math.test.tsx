/**
 * tests/MessageBubble.math.test.tsx
 *
 * LaTeX-Formeln in Assistenten-Antworten werden per KaTeX gesetzt statt
 * wörtlich angezeigt (Bug-Report 2026-07-22: „$O(n^2)$" stand roh im Chat).
 * Modelle schreiben sowohl $…$/$$…$$ als auch \(…\)/\[…\] — beides muss
 * gerendert werden.
 */

import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageBubble } from '../components/ChatArea/MessageBubble';
import type { Message } from '../types';

const mkMessage = (content: string): Message => ({
  id: 'a1',
  chat_id: '1',
  role: 'assistant',
  content,
  created_at: new Date().toISOString(),
});

const renderContent = (content: string) =>
  render(<MessageBubble message={mkMessage(content)} onWordRightClick={vi.fn()} />);

describe('math rendering in chat messages', () => {
  it('renders dollar-delimited inline math as KaTeX instead of raw text', () => {
    const { container } = renderContent('Attention scales in $O(n^2)$ time.');

    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).not.toContain('$O(n^2)$');
  });

  it('renders \\(...\\) inline math the way models often emit it', () => {
    const { container } = renderContent('The loss \\(\\mathcal{L}\\) decreases.');

    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).not.toContain('\\(');
  });

  it('renders \\[...\\] display math as a block formula', () => {
    const { container } = renderContent('Update rule:\n\n\\[\\theta \\leftarrow \\theta - \\eta \\nabla J(\\theta)\\]');

    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('leaves prose without math untouched', () => {
    const { container } = renderContent('Plain answer without formulas.');

    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toContain('Plain answer without formulas.');
  });

  it('promotes \\displaystyle inline math to its own display block', () => {
    // Modelle quetschen Monster-Formeln per \displaystyle in den Satz —
    // inline gequetscht kollidieren sie mit Nachbarzeilen (Report 2026-07-22).
    const { container } = renderContent(
      'The zeta function: $\\displaystyle \\zeta(s) = \\sum_{n=1}^{\\infty} \\frac{1}{n^s}$ appears mid-sentence.',
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('promotes inline math containing an environment (matrix etc.) to a display block', () => {
    const { container } = renderContent(
      'It looks like $\\begin{matrix} a & b \\\\ c & d \\end{matrix}$ inline.',
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('keeps small inline math inline', () => {
    const { container } = renderContent('Runs in $O(n^2)$ time.');

    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull();
  });
});

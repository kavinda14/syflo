/**
 * App.highlights.test.tsx
 *
 * Orchestration tests for the highlight flows in App.tsx (Slices 04–06):
 * swatch click persists a highlight, a second pick recolors instead of
 * duplicating, "Open as new chat" creates the branch AND links the
 * highlight, and the actions menu recolors/deletes/opens the linked chat.
 *
 * PdfView is mocked with a stub that exposes buttons to simulate the
 * selection right-click and highlight clicks — real DOM text selection
 * isn't available in jsdom, and the capture math has its own tests
 * (highlightZoom.test.ts, PdfView.test.tsx).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';
import { _resetLabelsCacheForTests } from '../hooks/useLabels';
import type { Chat, ChatDetail, Highlight, Paper } from '../types';

vi.mock('../api', () => ({
  TreeHasPdfError: class TreeHasPdfError extends Error {},
  api: {
    getTree: vi.fn(),
    getSettings: vi.fn(),
    getChat: vi.fn(),
    getTreePaper: vi.fn(),
    uploadPaper: vi.fn(),
    createChat: vi.fn(),
    deleteChat: vi.fn(),
    renameChat: vi.fn(),
    sendMessageStream: vi.fn(),
    explainWord: vi.fn(),
    listHighlights: vi.fn(),
    createHighlight: vi.fn(),
    updateHighlight: vi.fn(),
    deleteHighlight: vi.fn(),
    getHighlightLabels: vi.fn(),
    setHighlightLabel: vi.fn(),
  },
}));

// Stub-PdfView: reicht die App-Props über Testknöpfe durch. Ein Klick auf
// "simulate-pdf-rightclick" entspricht: Selektion erfasst, dann contextmenu.
vi.mock('../components/PdfView', () => ({
  PdfView: (props: {
    highlights?: Highlight[];
    onCaptureHighlight?: (sel: unknown) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onColorHighlightClick?: (h: Highlight, e: React.MouseEvent) => void;
  }) => (
    <div data-testid="fake-pdf-view">
      <button
        data-testid="simulate-pdf-rightclick"
        onClick={(e) => {
          props.onCaptureHighlight?.({
            pageNumber: 2,
            text: 'inverse dynamics model',
            rects: [{ left: 50, top: 25, width: 200, height: 12 }],
          });
          props.onContextMenu?.(e);
        }}
      />
      {(props.highlights ?? []).map((h) => (
        <button
          key={h.id}
          data-testid={`fake-highlight-${h.id}`}
          onClick={(e) => props.onColorHighlightClick?.(h, e)}
        />
      ))}
    </div>
  ),
}));

import { api } from '../api';

const rootChat: Chat = {
  id: 'c1',
  title: 'Paper chat',
  parent_id: null,
  parent_word: null,
  created_at: '2026-07-11T00:00:00Z',
  children: [],
};
const rootDetail: ChatDetail = { ...rootChat, messages: [], children: [] };

const paper: Paper = {
  id: 'p1',
  title: 'diffusion-policies',
  authors: [],
  uploaded_at: '2026-07-11T00:00:00Z',
  status: 'ready',
  pdf_url: '/api/papers/p1/pdf',
};

const savedHighlight: Highlight = {
  id: 'h1',
  paperId: 'p1',
  color: 'yellow',
  text: 'inverse dynamics model',
  pageNumber: 2,
  rects: [{ left: 50, top: 25, width: 200, height: 12 }],
  chatId: null,
  createdAt: 'x',
  updatedAt: 'x',
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetLabelsCacheForTests();
  vi.mocked(api.getTree).mockResolvedValue([rootChat]);
  vi.mocked(api.getSettings).mockRejectedValue(new Error('none'));
  vi.mocked(api.getChat).mockResolvedValue(rootDetail);
  vi.mocked(api.getTreePaper).mockResolvedValue(paper);
  vi.mocked(api.listHighlights).mockResolvedValue([]);
  vi.mocked(api.getHighlightLabels).mockResolvedValue({
    yellow: 'Important', green: 'Agree', blue: 'Reference', pink: 'Question', orange: 'Disagree',
  });
  vi.mocked(api.explainWord).mockResolvedValue({ explanation: 'A model that maps states to actions.' });
  vi.mocked(api.createHighlight).mockResolvedValue(savedHighlight);
  vi.mocked(api.updateHighlight).mockImplementation(async (_hid, patch) => ({ ...savedHighlight, ...patch }));
  vi.mocked(api.deleteHighlight).mockResolvedValue(undefined);
});

async function openPdfChatAndRightClick() {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Paper chat')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Paper chat'));
  await waitFor(() => expect(screen.getByTestId('fake-pdf-view')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('simulate-pdf-rightclick'));
  await waitFor(() => expect(screen.getByText(/inverse dynamics model/)).toBeInTheDocument());
}

describe('App — Highlight-Flows (Slices 04–06)', () => {
  it('Rechtsklick auf eine PDF-Selektion öffnet das Popup mit Farbzeile und Definition', async () => {
    await openPdfChatAndRightClick();
    expect(screen.getByTestId('popup-color-section')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/maps states to actions/)).toBeInTheDocument(),
    );
    expect(api.explainWord).toHaveBeenCalledWith('inverse dynamics model', expect.any(String));
  });

  it('Swatch-Klick persistiert das Highlight; zweiter Klick färbt um statt zu duplizieren (Slice 04)', async () => {
    await openPdfChatAndRightClick();
    await waitFor(() => expect(screen.getByText('Agree')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /highlight as agree/i }));
    await waitFor(() =>
      expect(api.createHighlight).toHaveBeenCalledWith('p1', {
        color: 'green',
        text: 'inverse dynamics model',
        pageNumber: 2,
        rects: [{ left: 50, top: 25, width: 200, height: 12 }],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /highlight as question/i }));
    await waitFor(() =>
      expect(api.updateHighlight).toHaveBeenCalledWith('h1', { color: 'pink' }),
    );
    expect(api.createHighlight).toHaveBeenCalledTimes(1);
  });

  it('"Open as new chat" erstellt den Branch und verknüpft das Highlight (Slice 06)', async () => {
    const branch: Chat = { ...rootChat, id: 'c2', title: 'About: inverse dynamics model', parent_id: 'c1' };
    vi.mocked(api.createChat).mockResolvedValue(branch);
    await openPdfChatAndRightClick();

    fireEvent.click(screen.getByText(/open as new chat/i));
    await waitFor(() =>
      expect(api.createChat).toHaveBeenCalledWith(
        'About: inverse dynamics model',
        'c1',
        'inverse dynamics model',
      ),
    );
    // Kein Swatch-Klick vorher → Highlight wird direkt mit chatId angelegt.
    await waitFor(() =>
      expect(api.createHighlight).toHaveBeenCalledWith('p1', expect.objectContaining({
        color: 'yellow',
        chatId: 'c2',
      })),
    );
  });

  it('nach Swatch-Klick verknüpft "Open as new chat" das vorhandene Highlight statt ein zweites anzulegen', async () => {
    const branch: Chat = { ...rootChat, id: 'c2', title: 'About: inverse dynamics model', parent_id: 'c1' };
    vi.mocked(api.createChat).mockResolvedValue(branch);
    await openPdfChatAndRightClick();
    await waitFor(() => expect(screen.getByText('Agree')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /highlight as agree/i }));
    await waitFor(() => expect(api.createHighlight).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText(/open as new chat/i));
    await waitFor(() =>
      expect(api.updateHighlight).toHaveBeenCalledWith('h1', { chatId: 'c2' }),
    );
    expect(api.createHighlight).toHaveBeenCalledTimes(1);
  });

  describe('Highlight-Aktionsmenü (Slice 06)', () => {
    async function openMenu(highlight: Highlight = savedHighlight) {
      vi.mocked(api.listHighlights).mockResolvedValue([highlight]);
      render(<App />);
      await waitFor(() => expect(screen.getByText('Paper chat')).toBeInTheDocument());
      fireEvent.click(screen.getByText('Paper chat'));
      await waitFor(() =>
        expect(screen.getByTestId(`fake-highlight-${highlight.id}`)).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId(`fake-highlight-${highlight.id}`));
      await waitFor(() =>
        expect(screen.getByTestId('highlight-actions-menu')).toBeInTheDocument(),
      );
    }

    it('bietet Umfärben an und patcht die Farbe', async () => {
      await openMenu();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Reference' })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
      await waitFor(() =>
        expect(api.updateHighlight).toHaveBeenCalledWith('h1', { color: 'blue' }),
      );
    });

    it('löscht das Highlight, ohne einen Chat anzurühren', async () => {
      await openMenu();
      fireEvent.click(screen.getByText(/delete highlight/i));
      await waitFor(() => expect(api.deleteHighlight).toHaveBeenCalledWith('h1'));
      expect(api.deleteChat).not.toHaveBeenCalled();
      expect(screen.queryByTestId('highlight-actions-menu')).not.toBeInTheDocument();
    });

    it('zeigt "Open linked chat" nur bei verknüpftem Branch und öffnet ihn', async () => {
      await openMenu({ ...savedHighlight, chatId: 'c9' });
      const linkedDetail: ChatDetail = {
        ...rootChat, id: 'c9', title: 'Linked branch', messages: [], children: [],
      };
      vi.mocked(api.getChat).mockResolvedValue(linkedDetail);
      fireEvent.click(screen.getByText(/open linked chat/i));
      await waitFor(() => expect(api.getChat).toHaveBeenCalledWith('c9'));
    });

    it('versteckt "Open linked chat" bei unverknüpften Highlights', async () => {
      await openMenu();
      expect(screen.queryByText(/open linked chat/i)).not.toBeInTheDocument();
    });
  });
});

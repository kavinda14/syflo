/**
 * App.test.tsx
 *
 * Integration tests for the slice-03 wiring in App.tsx: uploading a PDF via
 * the plus menu switches to the three-column view, the view is restored when
 * a chat whose tree has a paper is opened (reload case), and a second upload
 * into the same tree shows the new-tree prompt (ADR-0002).
 *
 * The API client and the pdf.js wrapper are mocked; everything between them
 * (App state, ChatArea menu, PdfView) is real.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';
import { TreeHasPdfError } from '../api';
import type { Chat, ChatDetail, Paper } from '../types';

const renderPage = vi.fn().mockResolvedValue(undefined);
vi.mock('../pdf/pdfDocument', () => ({
  loadPdfDocument: vi.fn().mockResolvedValue({
    numPages: 2,
    renderPage: (...args: unknown[]) => renderPage(...args),
  }),
}));

vi.mock('../api', () => ({
  TreeHasPdfError: class TreeHasPdfError extends Error {
    rootChatId: string | null;
    constructor(rootChatId: string | null) {
      super('tree-has-pdf');
      this.name = 'TreeHasPdfError';
      this.rootChatId = rootChatId;
    }
  },
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
  },
}));

import { api } from '../api';

const rootChat: Chat = {
  id: 'c1',
  title: 'Lease review',
  parent_id: null,
  parent_word: null,
  created_at: '2026-07-11T00:00:00Z',
  children: [],
};

const rootDetail: ChatDetail = { ...rootChat, messages: [], children: [] };

const paper: Paper = {
  id: 'p1',
  title: 'lease-agreement',
  authors: [],
  uploaded_at: '2026-07-11T00:00:00Z',
  status: 'ready',
  pdf_url: '/api/papers/p1/pdf',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getTree).mockResolvedValue([rootChat]);
  vi.mocked(api.getSettings).mockRejectedValue(new Error('none'));
  vi.mocked(api.getChat).mockResolvedValue(rootDetail);
  vi.mocked(api.getTreePaper).mockResolvedValue(null);
  vi.mocked(api.uploadPaper).mockResolvedValue(paper);
});

/** Render the app and open the root chat from the sidebar. */
async function openRootChat() {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Lease review')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Lease review'));
  await waitFor(() => expect(api.getChat).toHaveBeenCalledWith('c1'));
}

/** Pick a PDF through the plus menu's "Upload file" entry. */
async function uploadPdfViaPlusMenu(file: File) {
  fireEvent.click(screen.getByTestId('attach-plus-button'));
  fireEvent.click(screen.getByTestId('attach-menu-upload-pdf'));
  fireEvent.change(screen.getByTestId('pdf-file-input'), { target: { files: [file] } });
}

describe('App — PDF upload end-to-end (slice 03)', () => {
  it('switches to the three-column view after uploading a PDF', async () => {
    await openRootChat();
    expect(screen.queryByTestId('chat-pane-right')).not.toBeInTheDocument();

    const pdf = new File(['%PDF-1.4'], 'lease-agreement.pdf', { type: 'application/pdf' });
    await uploadPdfViaPlusMenu(pdf);

    await waitFor(() => expect(api.uploadPaper).toHaveBeenCalledWith('c1', pdf));
    // Center column renders the PDF, chat moves into the fixed right pane.
    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(2);
    });
    expect(screen.getByTestId('chat-pane-right')).toBeInTheDocument();
  });

  it('restores the three-column view when opening a chat whose tree has a PDF', async () => {
    vi.mocked(api.getTreePaper).mockResolvedValue(paper);
    await openRootChat();

    await waitFor(() => expect(api.getTreePaper).toHaveBeenCalledWith('c1'));
    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(2);
    });
    expect(screen.getByTestId('chat-pane-right')).toBeInTheDocument();
  });

  it('zeigt bei einem zweiten PDF im selben Tree den Neuer-Tree-Dialog (ADR-0002)', async () => {
    vi.mocked(api.getTreePaper).mockResolvedValue(paper);
    vi.mocked(api.uploadPaper).mockRejectedValueOnce(new TreeHasPdfError('c1'));
    await openRootChat();
    await waitFor(() => expect(screen.getByTestId('chat-pane-right')).toBeInTheDocument());

    const second = new File(['%PDF-1.4'], 'other.pdf', { type: 'application/pdf' });
    await uploadPdfViaPlusMenu(second);

    // Rejected with 'tree-has-pdf' → prompt instead of a new paper.
    await waitFor(() => expect(screen.getByTestId('new-tree-prompt')).toBeInTheDocument());
    expect(screen.getByTestId('new-tree-prompt')).toHaveTextContent('other.pdf');

    // Confirming creates a fresh root chat and uploads the held file there.
    const newChat: Chat = { ...rootChat, id: 'c2', title: 'New Chat' };
    vi.mocked(api.createChat).mockResolvedValue(newChat);
    vi.mocked(api.getChat).mockResolvedValue({ ...newChat, messages: [], children: [] });
    fireEvent.click(screen.getByTestId('new-tree-confirm'));

    await waitFor(() => expect(api.createChat).toHaveBeenCalledWith('New Chat'));
    await waitFor(() => expect(api.uploadPaper).toHaveBeenCalledWith('c2', second));
    expect(screen.queryByTestId('new-tree-prompt')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getChat).toHaveBeenCalledWith('c2'));
  });

  it('schließt den Dialog bei Cancel, ohne etwas hochzuladen', async () => {
    vi.mocked(api.getTreePaper).mockResolvedValue(paper);
    vi.mocked(api.uploadPaper).mockRejectedValueOnce(new TreeHasPdfError('c1'));
    await openRootChat();
    await waitFor(() => expect(screen.getByTestId('chat-pane-right')).toBeInTheDocument());

    await uploadPdfViaPlusMenu(new File(['%PDF-1.4'], 'other.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByTestId('new-tree-prompt')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('new-tree-cancel'));
    expect(screen.queryByTestId('new-tree-prompt')).not.toBeInTheDocument();
    expect(api.createChat).not.toHaveBeenCalled();
  });
});

/**
 * api.test.ts
 *
 * Unit tests for the frontend API client.
 * Uses fetch mocking to avoid real network calls.
 *
 * The most important tests are for sendMessageStream because it contains
 * custom SSE parsing logic: buffering partial lines across network chunks,
 * calling onDelta for each text piece, and resolving with the final messages.
 * A bug here would break the entire streaming feature.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, TreeHasPdfError } from '../api';
import type { Message } from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a mock fetch response that returns a simple JSON body. */
function mockJsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Build a mock fetch response whose body is a ReadableStream of SSE events. */
function mockSSEResponse(events: object[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        // Each event is a complete SSE line ending with a blank line
        const line = `data: ${JSON.stringify(events[index++])}\n\n`;
        controller.enqueue(encoder.encode(line));
      } else {
        controller.close();
      }
    },
  });
  return Promise.resolve({ ok: true, body: stream } as Response);
}

const mockUser: Message = {
  id: 'u1', chat_id: 'c1', role: 'user', content: 'Hello', created_at: '2024-01-01T00:00:00Z',
};
const mockAssistant: Message = {
  id: 'a1', chat_id: 'c1', role: 'assistant', content: 'Hello world', created_at: '2024-01-01T00:00:01Z',
};

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── getTree ────────────────────────────────────────────────────────────────

describe('api.getTree', () => {
  it('fetches the chat tree from GET /api/chats/tree', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse([{ id: '1', title: 'Chat 1' }]));
    const result = await api.getTree();
    expect(fetch).toHaveBeenCalledWith('/api/chats/tree');
    expect(result).toEqual([{ id: '1', title: 'Chat 1' }]);
  });

  it('throws when the response is not ok', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({}, 500));
    await expect(api.getTree()).rejects.toThrow('Failed to fetch tree');
  });
});

// ─── getChat ────────────────────────────────────────────────────────────────

describe('api.getChat', () => {
  it('fetches a single chat by id', async () => {
    const mockChat = { id: 'abc', title: 'My Chat', messages: [], children: [] };
    vi.mocked(fetch).mockReturnValue(mockJsonResponse(mockChat));
    const result = await api.getChat('abc');
    expect(fetch).toHaveBeenCalledWith('/api/chats/abc');
    expect(result.id).toBe('abc');
  });

  it('throws on 404', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ error: 'Not found' }, 404));
    await expect(api.getChat('nonexistent')).rejects.toThrow('Failed to fetch chat');
  });
});

// ─── createChat ─────────────────────────────────────────────────────────────

describe('api.createChat', () => {
  it('sends POST with title', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ id: 'new1', title: 'New Chat' }));
    await api.createChat('New Chat');
    expect(fetch).toHaveBeenCalledWith('/api/chats', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'New Chat', parent_id: undefined, parent_word: undefined }),
    }));
  });

  it('includes parent_id and parent_word when branching', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ id: 'child1', title: 'Child' }));
    await api.createChat('Child', 'parent1', 'quantum');
    expect(fetch).toHaveBeenCalledWith('/api/chats', expect.objectContaining({
      body: JSON.stringify({ title: 'Child', parent_id: 'parent1', parent_word: 'quantum' }),
    }));
  });
});

// ─── sendMessageStream ──────────────────────────────────────────────────────

describe('api.sendMessageStream', () => {
  it('calls onDelta for each streamed text chunk', async () => {
    vi.mocked(fetch).mockReturnValue(mockSSEResponse([
      { delta: 'Hello' },
      { delta: ' world' },
      { done: true, userMessage: mockUser, assistantMessage: mockAssistant },
    ]));

    const deltas: string[] = [];
    await api.sendMessageStream('c1', 'Hi', d => deltas.push(d));

    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('returns userMessage and assistantMessage from the done event', async () => {
    vi.mocked(fetch).mockReturnValue(mockSSEResponse([
      { delta: 'Hi!' },
      { done: true, userMessage: mockUser, assistantMessage: mockAssistant },
    ]));

    const result = await api.sendMessageStream('c1', 'Hello', vi.fn());

    expect(result.userMessage.id).toBe('u1');
    expect(result.assistantMessage.content).toBe('Hello world');
  });

  it('sends POST to the correct URL with the message content', async () => {
    vi.mocked(fetch).mockReturnValue(mockSSEResponse([
      { done: true, userMessage: mockUser, assistantMessage: mockAssistant },
    ]));

    await api.sendMessageStream('chat99', 'Test message', vi.fn());

    expect(fetch).toHaveBeenCalledWith('/api/chats/chat99/messages', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ content: 'Test message' }),
    }));
  });

  it('throws when the error event is received', async () => {
    vi.mocked(fetch).mockReturnValue(mockSSEResponse([
      { error: 'Ollama is not running' },
    ]));

    await expect(
      api.sendMessageStream('c1', 'Hi', vi.fn())
    ).rejects.toThrow('Ollama is not running');
  });

  it('handles multiple SSE chunks arriving in one network packet', async () => {
    // Simulate two events packed into a single ReadableStream chunk
    const encoder = new TextEncoder();
    const combined =
      `data: ${JSON.stringify({ delta: 'A' })}\n\n` +
      `data: ${JSON.stringify({ delta: 'B' })}\n\n` +
      `data: ${JSON.stringify({ done: true, userMessage: mockUser, assistantMessage: mockAssistant })}\n\n`;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(combined));
        controller.close();
      },
    });

    vi.mocked(fetch).mockReturnValue(Promise.resolve({ ok: true, body: stream } as Response));

    const deltas: string[] = [];
    await api.sendMessageStream('c1', 'Hi', d => deltas.push(d));

    expect(deltas).toEqual(['A', 'B']);
  });
});

// ─── explainWord ────────────────────────────────────────────────────────────

describe('api.explainWord', () => {
  it('sends POST with word and context', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ explanation: 'A quantum is...' }));
    const result = await api.explainWord('quantum', 'physics lesson');
    expect(fetch).toHaveBeenCalledWith('/api/explain', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ word: 'quantum', context: 'physics lesson' }),
    }));
    expect(result.explanation).toBe('A quantum is...');
  });
});

// ─── deleteChat ─────────────────────────────────────────────────────────────

describe('api.deleteChat', () => {
  it('sends DELETE to the correct URL', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ success: true }));
    await api.deleteChat('chat42');
    expect(fetch).toHaveBeenCalledWith('/api/chats/chat42', { method: 'DELETE' });
  });
});

// ─── uploadPaper / getTreePaper (Slice 03) ──────────────────────────────────

describe('api.uploadPaper', () => {
  const pdf = new File(['%PDF-1.4'], 'lease.pdf', { type: 'application/pdf' });

  it('POSTs the PDF as multipart form data with the chat_id', async () => {
    const paper = { id: 'p1', title: 'lease', authors: [], uploaded_at: 'x', status: 'ready', pdf_url: '/api/papers/p1/pdf' };
    vi.mocked(fetch).mockReturnValue(mockJsonResponse(paper, 201));

    const result = await api.uploadPaper('c1', pdf);

    expect(fetch).toHaveBeenCalledWith('/api/papers', expect.objectContaining({ method: 'POST' }));
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('chat_id')).toBe('c1');
    // jsdom klont Dateien beim FormData.append — Identität ist nicht garantiert,
    // also Name/Typ vergleichen statt toBe.
    const sent = body.get('pdf') as File;
    expect(sent.name).toBe('lease.pdf');
    expect(sent.type).toBe('application/pdf');
    expect(result).toEqual(paper);
  });

  it('wirft TreeHasPdfError mit root_chat_id bei 409 (ADR-0002)', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ error: 'tree-has-pdf', root_chat_id: 'root9' }, 409));
    const err = await api.uploadPaper('c1', pdf).catch(e => e);
    expect(err).toBeInstanceOf(TreeHasPdfError);
    expect((err as TreeHasPdfError).rootChatId).toBe('root9');
  });

  it('throws a plain error on other failures', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({}, 500));
    await expect(api.uploadPaper('c1', pdf)).rejects.toThrow('Failed to upload PDF');
  });
});

describe('api.getTreePaper', () => {
  it('returns the paper bound to the chat tree', async () => {
    const paper = { id: 'p1', title: 'lease', authors: [], uploaded_at: 'x', status: 'ready', pdf_url: '/api/papers/p1/pdf' };
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ paper }));
    const result = await api.getTreePaper('c1');
    expect(fetch).toHaveBeenCalledWith('/api/papers/for-chat/c1');
    expect(result).toEqual(paper);
  });

  it('returns null when the tree has no PDF', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ paper: null }));
    expect(await api.getTreePaper('c1')).toBeNull();
  });
});

// ─── searchPapers / importPaperFromUrl (Slice 07) ───────────────────────────

describe('api.searchPapers', () => {
  it('fetches merged results from GET /api/papers/search', async () => {
    const body = { results: [{ id: 'W1', title: 'A' }], rate_limited: false };
    vi.mocked(fetch).mockReturnValue(mockJsonResponse(body));
    const result = await api.searchPapers('attention is all');
    expect(fetch).toHaveBeenCalledWith('/api/papers/search?q=attention%20is%20all');
    expect(result).toEqual(body);
  });
});

describe('api.importPaperFromUrl', () => {
  it('POSTs url, title, fallbacks and chat_id', async () => {
    const paper = { id: 'p1', title: 'A', authors: [], uploaded_at: 'x', status: 'ready', pdf_url: '/api/papers/p1/pdf' };
    vi.mocked(fetch).mockReturnValue(mockJsonResponse(paper, 201));
    const result = await api.importPaperFromUrl('c1', 'https://arxiv.org/pdf/1.pdf', 'A', ['https://mirror/1.pdf']);
    expect(fetch).toHaveBeenCalledWith('/api/papers/from-url', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        url: 'https://arxiv.org/pdf/1.pdf',
        title: 'A',
        fallback_urls: ['https://mirror/1.pdf'],
        chat_id: 'c1',
      }),
    }));
    expect(result).toEqual(paper);
  });

  it('wirft TreeHasPdfError bei 409 (ADR-0002)', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ error: 'tree-has-pdf', root_chat_id: 'root1' }, 409));
    const err = await api.importPaperFromUrl('c1', 'https://arxiv.org/pdf/1.pdf').catch(e => e);
    expect(err).toBeInstanceOf(TreeHasPdfError);
    expect((err as TreeHasPdfError).rootChatId).toBe('root1');
  });

  it('reicht die Backend-Fehlermeldung durch (z. B. Publisher-Block)', async () => {
    vi.mocked(fetch).mockReturnValue(mockJsonResponse({ error: 'Publisher blocks direct download (HTTP 403).' }, 502));
    await expect(api.importPaperFromUrl('c1', 'https://x/y.pdf')).rejects.toThrow(/Publisher blocks/);
  });
});

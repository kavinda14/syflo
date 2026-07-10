/**
 * api/index.ts
 *
 * Central API client for all communication between the React frontend and the
 * Express backend. Each function maps directly to one backend route.
 *
 * The most important function here is sendMessageStream, which replaced the old
 * sendMessage. Instead of waiting for a complete JSON response, it reads the
 * Server-Sent Events stream from the backend and calls onDelta for every text
 * chunk so the UI can update in real time — exactly like ChatGPT's typing effect.
 */

import type { Chat, ChatDetail, LocalAttachment, Message, Settings, SettingsUpdate, ToolEvent } from '../types';

const BASE = '/api';

export const api = {
  // Fetches the full chat tree (all chats with their children nested).
  // Used to populate the sidebar.
  async getTree(): Promise<Chat[]> {
    const res = await fetch(`${BASE}/chats/tree`);
    if (!res.ok) throw new Error('Failed to fetch tree');
    return res.json();
  },

  // Fetches a single chat including all its messages and direct child chats.
  async getChat(id: string): Promise<ChatDetail> {
    const res = await fetch(`${BASE}/chats/${id}`);
    if (!res.ok) throw new Error('Failed to fetch chat');
    return res.json();
  },

  // Creates a new chat. parent_id and parent_word are set when branching from
  // a specific word in an existing conversation.
  async createChat(title: string, parent_id?: string, parent_word?: string): Promise<Chat> {
    const res = await fetch(`${BASE}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, parent_id, parent_word }),
    });
    if (!res.ok) throw new Error('Failed to create chat');
    return res.json();
  },

  // Sends a user message (mit optionalen Datei-Anhängen) und streamt die AI-Antwort.
  // onDelta wird mit jedem Text-Chunk aufgerufen, der vom Server ankommt.
  // Wenn Anhänge dabei sind, wird multipart/form-data verwendet — sonst JSON.
  async sendMessageStream(
    chatId: string,
    content: string,
    onDelta: (delta: string) => void,
    attachments: LocalAttachment[] = [],
    // Called whenever the model invokes a tool (e.g. web_search) during the
    // streaming response. The UI uses this to show "Searching the web for X…"
    // and then a sources list once results come back.
    onToolEvent?: (evt: ToolEvent) => void,
  ): Promise<{ userMessage: Message; assistantMessage: Message }> {
    let res: Response;
    if (attachments.length > 0) {
      const fd = new FormData();
      fd.append('content', content);
      fd.append('aliases', JSON.stringify(attachments.map(a => a.alias)));
      attachments.forEach(a => fd.append('files', a.file, a.file.name));
      res = await fetch(`${BASE}/chats/${chatId}/messages`, {
        method: 'POST',
        body: fd, // KEIN explicit Content-Type — Browser setzt es mit Boundary
      });
    } else {
      res = await fetch(`${BASE}/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    }

    if (!res.ok) throw new Error('Failed to send message');

    // Read the SSE response body incrementally.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the binary chunk and append it to a buffer, because a single
      // network packet may contain partial SSE lines.
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep the last (possibly incomplete) line in the buffer for next iteration.
      buffer = lines.pop() || '';

      // Process each complete SSE line.
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.error) throw new Error(data.error);

        // A text delta — pass it to the callback so the UI can append it.
        if (data.delta) onDelta(data.delta);

        // A tool event — the model called a tool (e.g. web_search). The UI
        // uses this for the "Searching…" indicator and the sources list.
        if (data.tool && onToolEvent) onToolEvent(data.tool as ToolEvent);

        // The final event — streaming is complete, return the persisted messages.
        if (data.done) return { userMessage: data.userMessage, assistantMessage: data.assistantMessage };
      }
    }

    throw new Error('Stream ended without completion');
  },

  // Fetches a short explanation for a word, used by the floating popup.
  async explainWord(word: string, context: string): Promise<{ explanation: string }> {
    const res = await fetch(`${BASE}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, context }),
    });
    if (!res.ok) throw new Error('Failed to explain word');
    return res.json();
  },

  // Deletes a chat and all its children (handled recursively on the backend).
  async deleteChat(id: string): Promise<void> {
    const res = await fetch(`${BASE}/chats/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to delete chat (HTTP ${res.status})`);
    }
  },

  // Renames a chat (updates only its title).
  async renameChat(id: string, title: string): Promise<Chat> {
    const res = await fetch(`${BASE}/chats/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error('Failed to rename chat');
    return res.json();
  },

  // Settings: aktiver LLM-Provider, Modelle, ob ein OpenAI-Key gesetzt ist.
  // Der API-Key selbst wird nie zurückgeschickt — nur ein Boolean-Status.
  async getSettings(): Promise<Settings> {
    const res = await fetch(`${BASE}/settings`);
    if (!res.ok) throw new Error('Failed to fetch settings');
    return res.json();
  },

  // Lists models currently pulled in the user's local Ollama installation.
  // Returns an empty array if Ollama isn't reachable so the modal can fall back
  // to free-text input without surfacing an error.
  async getOllamaModels(): Promise<{ name: string; size?: number; parameter_size?: string }[]> {
    try {
      const res = await fetch(`${BASE}/settings/ollama-models`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.models) ? data.models : [];
    } catch {
      return [];
    }
  },

  // Partielles Update. Felder, die nicht im Objekt sind, bleiben unverändert.
  // Für openai_api_key: leerer String löscht den gespeicherten Key.
  async updateSettings(patch: SettingsUpdate): Promise<Settings> {
    const res = await fetch(`${BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update settings');
    }
    return res.json();
  },
};

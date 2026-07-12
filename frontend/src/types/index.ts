export interface Chat {
  id: string;
  title: string;
  parent_id: string | null;
  parent_word: string | null;
  created_at: string;
  child_count?: number;
  children?: Chat[];
  // Erste Nutzer-Frage, gekürzt — wird in der Mindmap angezeigt, damit man
  // auf einen Blick sieht, worum es im Chat geht.
  preview?: string | null;
  message_count?: number;
  // ID des an den Tree gebundenen PDFs — nur am Root gesetzt (ADR-0002).
  // Rendert den PDF-Tag am Root-Knoten im Chat tree.
  paper_id?: string | null;
}

export interface Attachment {
  id: string;
  alias: string;       // z. B. "@foto1"
  filename: string;
  mimetype: string;
  size: number;
  url: string;         // backend-served URL, z. B. "/uploads/<chat-id>/<id>-<filename>"
}

// Lokale Repräsentation eines Anhangs vor dem Hochladen
// (im Speicher, noch nicht persistiert).
export interface LocalAttachment {
  alias: string;
  file: File;
  previewUrl?: string; // object URL für Bilder-Vorschau
}

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ToolEvent {
  phase: 'call' | 'result';
  name: string;
  args?: { query?: string };
  result?: { query?: string; results?: SearchSource[]; error?: string } | null;
}

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  attachments?: Attachment[];
  // Transient (not persisted): sources surfaced from a web_search tool call
  // during the streaming session this message was produced in. Populated by
  // the streaming client; lost on page reload.
  sources?: SearchSource[];
}

export interface ChatDetail extends Chat {
  messages: Message[];
  children: Chat[];
}

// Ein an einen Chat tree gebundenes PDF (ADR-0002: max. eins pro Tree).
// Minimaler Syflo-Port ohne Parsing — status ist praktisch immer 'ready'.
export interface Paper {
  id: string;
  title: string | null;
  authors: string[];
  uploaded_at: string;
  status: 'parsing' | 'ready' | 'failed';
  pdf_url: string;
}

// ─── Highlights (Syflo-Port, Slices 04–06) ──────────────────────────────────

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
] as const;

// Global per-color labels. User-renamable via the FloatingPopup's edit mode.
// Stored server-side so they survive reloads.
export type HighlightLabels = Record<HighlightColor, string>;
export const DEFAULT_HIGHLIGHT_LABELS: HighlightLabels = {
  yellow: 'Important',
  green: 'Agree',
  blue: 'Reference',
  pink: 'Question',
  orange: 'Disagree',
};

// One rectangle in *unscaled* (zoom=1) page-local coordinates. All four
// values are normalized by the capture zoom and multiplied by the live zoom
// at render time — the fix for Syflo's only-position-normalized zoom bug.
export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Highlight {
  id: string;
  paperId: string;
  color: HighlightColor;
  text: string;
  pageNumber: number;
  rects: HighlightRect[];
  // Optional anchor context (~30 chars of text either side of the quote).
  // Reserved for future re-anchoring when a PDF's underlying text reflows.
  prefix?: string | null;
  suffix?: string | null;
  quoteHash?: string | null;
  chatId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Payload accepted by POST /api/papers/:id/highlights. Mirrors the backend
// validation; required fields here mean "the request will 400 without them".
export interface CreateHighlightPayload {
  color: HighlightColor;
  text: string;
  pageNumber: number;
  rects: HighlightRect[];
  prefix?: string | null;
  suffix?: string | null;
  quoteHash?: string | null;
  chatId?: string | null;
}

export interface WordPopup {
  word: string;
  context: string;
  x: number;
  y: number;
}

export type LLMProvider = 'ollama' | 'openai';

// Settings, wie sie vom Backend zurückkommen. Der API-Key selbst wird
// nie ans Frontend geschickt — nur ein Boolean, ob einer gesetzt ist.
export interface Settings {
  llm_provider: LLMProvider;
  openai_model: string;
  ollama_model: string;
  openai_api_key_set: boolean;
}

// Updates an die Settings — alle Felder optional (Partial Update).
// `openai_api_key` ist hier der Klartext-Key, den der User eingibt.
export interface SettingsUpdate {
  llm_provider?: LLMProvider;
  openai_api_key?: string;
  openai_model?: string;
  ollama_model?: string;
}

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

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  attachments?: Attachment[];
}

export interface ChatDetail extends Chat {
  messages: Message[];
  children: Chat[];
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

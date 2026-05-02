export interface Chat {
  id: string;
  title: string;
  parent_id: string | null;
  parent_word: string | null;
  created_at: string;
  child_count?: number;
  children?: Chat[];
}

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
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

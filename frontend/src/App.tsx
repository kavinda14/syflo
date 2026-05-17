/**
 * App.tsx
 *
 * Root component that owns all application state and orchestrates communication
 * between the sidebar, chat area, mind map, and floating popup.
 *
 * Key responsibility: streaming state management.
 * When the user sends a message, App.tsx immediately adds two temporary messages
 * (the user's message and an empty assistant placeholder) to the active chat.
 * As text chunks arrive from the backend, it updates the placeholder in place so
 * the user sees the response building word-by-word. Once streaming finishes, the
 * temporary messages are swapped for the real persisted versions from the server.
 */

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { MindMap } from './components/MindMap';
import { FloatingPopup } from './components/FloatingPopup';
import { api } from './api';
import type { Chat, ChatDetail, LocalAttachment, Message, Settings, WordPopup } from './types';

export default function App() {
  // chats: the full tree shown in the sidebar
  const [chats, setChats] = useState<Chat[]>([]);

  // activeChat: the currently open chat including its messages
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'chat' | 'mindmap'>('chat');
  const [loadingChat, setLoadingChat] = useState(false);

  // Active LLM settings — surfaced in the sidebar footer so the user always
  // knows which provider/model is being used (and whose API key is paying).
  const [settings, setSettings] = useState<Settings | null>(null);

  // streaming: true while the AI is generating its response
  const [streaming, setStreaming] = useState(false);

  // popup: the word the user right-clicked on, plus its screen coordinates
  const [popup, setPopup] = useState<WordPopup | null>(null);
  const [explanation, setExplanation] = useState('');
  const [loadingExplanation, setLoadingExplanation] = useState(false);

  // Re-fetch the sidebar tree whenever a chat is created, renamed, or deleted.
  const refreshTree = useCallback(async () => {
    const tree = await api.getTree();
    setChats(tree);
  }, []);

  // Load the sidebar tree on initial render.
  useEffect(() => { refreshTree(); }, [refreshTree]);

  // Load current LLM settings on initial render so the sidebar footer can show
  // them right away. Failures are non-fatal — the footer simply renders nothing.
  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  // The mindmap toggle is hidden when no chat is active. If the user was in
  // mindmap view and the active chat goes away (e.g. deleted), drop them back
  // into chat view so they don't get stuck without the toggle.
  useEffect(() => {
    if (!activeChatId && viewMode === 'mindmap') setViewMode('chat');
  }, [activeChatId, viewMode]);

  // Load a chat's messages and mark it as active in the sidebar.
  const handleSelectChat = async (id: string) => {
    setActiveChatId(id);
    setLoadingChat(true);
    try {
      const chat = await api.getChat(id);
      setActiveChat(chat);
    } finally {
      setLoadingChat(false);
    }
  };

  // Create a blank chat and immediately open it.
  const handleNewChat = async () => {
    const chat = await api.createChat('New Chat');
    await refreshTree();
    await handleSelectChat(chat.id);
  };

  // Delete a chat; if it was the active chat, clear the chat area.
  const handleDeleteChat = async (id: string) => {
    await api.deleteChat(id);
    if (activeChatId === id) {
      setActiveChatId(null);
      setActiveChat(null);
    }
    await refreshTree();
  };

  // Rename a chat. Also patch the active chat so the header updates instantly.
  const handleRenameChat = async (id: string, title: string) => {
    await api.renameChat(id, title);
    if (activeChatId === id && activeChat) {
      setActiveChat({ ...activeChat, title });
    }
    await refreshTree();
  };

  // Send a message with optimistic UI and real-time streaming.
  const handleSendMessage = async (content: string, attachments: LocalAttachment[] = []) => {
    if (!activeChatId) return;

    // Create temporary IDs for the optimistic messages.
    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const now = new Date().toISOString();

    // Optimistische Anhänge: nur die Felder, die das UI braucht, mit Object-URLs als Vorschau.
    const optimisticAttachments = attachments.map((a, i) => ({
      id: `temp-att-${Date.now()}-${i}`,
      alias: a.alias,
      filename: a.file.name,
      mimetype: a.file.type,
      size: a.file.size,
      url: a.previewUrl || '',
    }));

    // Immediately add the user's message and an empty assistant placeholder
    // so the UI feels instant and shows the streaming cursor right away.
    const tempUser: Message = { id: tempUserId, chat_id: activeChatId, role: 'user', content, created_at: now, attachments: optimisticAttachments };
    const tempAssistant: Message = { id: tempAssistantId, chat_id: activeChatId, role: 'assistant', content: '', created_at: now };

    setActiveChat(prev => prev ? { ...prev, messages: [...prev.messages, tempUser, tempAssistant] } : prev);
    setStreaming(true);

    try {
      // Stream the response — onDelta appends each chunk to the placeholder message.
      const { userMessage, assistantMessage } = await api.sendMessageStream(
        activeChatId,
        content,
        (delta) => {
          setActiveChat(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map(m =>
                m.id === tempAssistantId ? { ...m, content: m.content + delta } : m
              ),
            };
          });
        },
        attachments,
      );

      // Replace the temporary messages with the real persisted ones from the server.
      setActiveChat(prev => {
        if (!prev) return prev;
        const filtered = prev.messages.filter(m => m.id !== tempUserId && m.id !== tempAssistantId);
        return { ...prev, messages: [...filtered, userMessage, assistantMessage] };
      });

      // Refresh the sidebar to pick up the auto-generated title after the first message.
      await refreshTree();
    } catch (err) {
      // On error, remove the optimistic messages so the UI stays consistent.
      setActiveChat(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.filter(m => m.id !== tempUserId && m.id !== tempAssistantId),
        };
      });
      console.error('Failed to send message:', err);
    } finally {
      setStreaming(false);
    }
  };

  // Fetch an explanation for a right-clicked word and show the floating popup.
  const handleWordRightClick = async (wordPopup: WordPopup) => {
    setPopup(wordPopup);
    setExplanation('');
    setLoadingExplanation(true);
    try {
      const res = await api.explainWord(wordPopup.word, wordPopup.context);
      setExplanation(res.explanation || '(No definition returned)');
    } catch (err) {
      // Without a catch, a backend/Ollama failure produced an empty popup with
      // no feedback. Surface the error so the user knows what happened.
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setExplanation(`Could not load definition: ${msg}`);
      console.error('explainWord failed:', err);
    } finally {
      setLoadingExplanation(false);
    }
  };

  // Create a child chat branched from the word shown in the popup, then open it.
  const handleOpenChildChat = async (word: string) => {
    if (!activeChatId) return;
    setPopup(null);
    const child = await api.createChat(`About: ${word}`, activeChatId, word);
    await refreshTree();
    await handleSelectChat(child.id);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar: chat list, new chat button, and mind map toggle */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelect={handleSelectChat}
        onNewChat={handleNewChat}
        onDelete={handleDeleteChat}
        onRename={handleRenameChat}
        viewMode={viewMode}
        onToggleView={() => setViewMode(v => v === 'chat' ? 'mindmap' : 'chat')}
        settings={settings}
        onSettingsChange={setSettings}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mind map view: shown as the top half when the toggle is active */}
        {viewMode === 'mindmap' && (
          <div className="h-1/2 border-b border-gray-200">
            <MindMap
              chats={chats}
              activeChatId={activeChatId}
              onSelect={handleSelectChat}
            />
          </div>
        )}

        {/* Chat area: takes full height in chat mode, or the bottom half in mind map mode */}
        <div className={`${viewMode === 'mindmap' ? 'h-1/2' : 'h-full'} flex overflow-hidden`}>
          <ChatArea
            chat={activeChat}
            loading={loadingChat}
            streaming={streaming}
            onSendMessage={handleSendMessage}
            onWordRightClick={handleWordRightClick}
            onSelectChat={handleSelectChat}
          />
        </div>
      </div>

      {/* Floating popup: appears near the right-clicked word with its explanation */}
      <FloatingPopup
        popup={popup}
        explanation={explanation}
        loading={loadingExplanation}
        onClose={() => setPopup(null)}
        onOpenChildChat={handleOpenChildChat}
      />
    </div>
  );
}

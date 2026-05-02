/**
 * components/ChatArea/index.tsx
 *
 * The main conversation panel. Renders the message history, the auto-expanding
 * input field, the send button, and the microphone button for voice dictation.
 */

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Plus, ArrowUp, ChevronDown } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import type { ChatDetail, WordPopup } from '../../types';

interface Props {
  chat: ChatDetail | null;
  loading: boolean;
  streaming: boolean;
  onSendMessage: (content: string) => Promise<void>;
  onWordRightClick: (popup: WordPopup) => void;
  onSelectChat: (id: string) => void;
}

// Distance from the bottom (in px) at which we still consider the user "at the bottom".
// Below this threshold, new content auto-scrolls; above it, we leave the user alone
// so they can read older messages without being yanked back down.
const NEAR_BOTTOM_THRESHOLD = 80;

export function ChatArea({ chat, loading, streaming, onSendMessage, onWordRightClick, onSelectChat }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatColumnClass = 'shrink-0 px-6 sm:px-8';
  const chatColumnStyle = { width: '46rem', maxWidth: 'calc(100% - 3rem)' };

  const { isListening, liveText, supported, startListening, stopListening } = useVoiceInput({
    onTranscript: (text) => {
      setInput(prev => prev ? prev + ' ' + text.trim() : text.trim());
    },
  });

  // Track whether the user is near the bottom of the message list. Updated on
  // every scroll event so the auto-scroll effect below can decide whether to
  // follow new content or stay put.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsAtBottom(distanceFromBottom < NEAR_BOTTOM_THRESHOLD);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Smart auto-scroll: only follow new content if the user is already at the
  // bottom. If they've scrolled up to read, leave them there.
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [chat?.messages, streaming, isAtBottom]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Expand the textarea vertically as the user types, capped at 144px.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 44), 144)}px`;
  }, [input]);

  const handleSend = async () => {
    const text = (input + (liveText ? ' ' + liveText : '')).trim();
    if (!text || sending || !chat) return;
    if (isListening) stopListening();
    setInput('');
    setSending(true);
    try {
      await onSendMessage(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isBusy = sending || streaming || loading;

  // Empty state: shown when no chat is selected.
  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center max-w-lg px-8">
          <h2 className="text-[32px] font-serif text-gray-800 mb-3 tracking-tight">How can I help you today?</h2>
          <p className="text-gray-500 text-[15px] leading-relaxed">Select a chat from the sidebar or start a new one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
      {/* Header: chat title */}
      <div className="border-b border-gray-100 bg-white">
        <div className="flex justify-center">
          <div className={`${chatColumnClass} py-7`} style={chatColumnStyle} data-testid="chat-header-shell">
            <h2 className="font-semibold text-gray-900 text-base truncate">{chat.title}</h2>
          </div>
        </div>
      </div>

      {/* Message list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="flex justify-center">
          <div
            className={`${chatColumnClass} flex flex-col py-8`}
            style={chatColumnStyle}
            data-testid="chat-content-shell"
          >
            {/* Blue hyperlink back to parent chat — shown at the top of branched chats */}
            {chat.parent_word && chat.parent_id && (
              <div className="flex w-full items-center gap-1.5 border-b border-gray-100 pb-2 text-sm">
                <span className="material-icons text-[14px] text-gray-400">subdirectory_arrow_left</span>
                <span className="text-gray-400">Branched from </span>
                <button
                  onClick={() => onSelectChat(chat.parent_id!)}
                  className="text-blue-600 underline underline-offset-2 hover:text-blue-800 font-medium transition-colors"
                >
                  "{chat.parent_word}"
                </button>
              </div>
            )}

            {chat.messages.length === 0 && (
              <div className="w-full pt-16 text-center text-sm text-gray-400">
                <p className="text-base font-medium text-gray-500 mb-1">Start the conversation</p>
                <p className="text-xs">Right-click any word in a response to get a definition or branch a new chat.</p>
              </div>
            )}

            {chat.messages.map((msg, i) => {
              const isLastAssistant = msg.role === 'assistant' && i === chat.messages.length - 1;
              const branchWords = chat.children
                .filter(c => c.parent_word)
                .map(c => ({ word: c.parent_word!, chatId: c.id }));
              return (
                <div
                  key={msg.id}
                  data-testid={`message-row-${msg.id}`}
                  style={{ marginTop: i === 0 ? 0 : '2rem' }}
                >
                  <MessageBubble
                    message={msg}
                    isStreaming={isLastAssistant && (sending || streaming)}
                    onWordRightClick={(word, context, x, y) =>
                      onWordRightClick({ word, context, x, y })
                    }
                    branchWords={branchWords}
                    onBranchClick={onSelectChat}
                  />
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* Live voice transcript preview */}
      {isListening && liveText && (
        <div className="flex justify-center">
          <div className={`${chatColumnClass} pb-1`} style={chatColumnStyle}>
            <div className="text-sm text-gray-400 italic px-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-400 animate-pulse mr-2" />
              {liveText}
            </div>
          </div>
        </div>
      )}

      {/* Input area — full width */}
      <div className="bg-white pb-6 pt-3">
        <div className="flex justify-center">
          <div className={chatColumnClass} style={chatColumnStyle} data-testid="chat-input-shell">
            <div className={`flex items-center gap-2 bg-white border border-gray-300 rounded-full pl-2 pr-3 py-2 shadow-sm transition-all ${
              isListening
                ? 'border-red-300 ring-2 ring-red-100'
                : 'focus-within:border-gray-400'
            }`}>
              <button
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                title="Attach"
              >
                <Plus size={20} strokeWidth={1.75} />
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? 'Listening...' : 'Ask anything'}
                rows={1}
                disabled={isBusy}
                className="min-h-[44px] flex-1 bg-transparent px-2 py-[10px] text-[16px] text-gray-900 placeholder-gray-400 outline-none resize-none leading-[1.5] disabled:opacity-50"
              />

              {supported && (
                <button
                  onMouseDown={startListening}
                  onMouseUp={stopListening}
                  onTouchStart={startListening}
                  onTouchEnd={stopListening}
                  title="Hold to speak"
                  className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
                    isListening
                      ? 'text-red-500 bg-red-50'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {isListening ? <MicOff size={20} strokeWidth={1.9} /> : <Mic size={20} strokeWidth={1.9} />}
                </button>
              )}

              <button
                onClick={handleSend}
                disabled={isBusy || (!input.trim() && !liveText)}
                title="Send"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 text-white transition-all hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUp size={20} strokeWidth={2.25} />
              </button>
            </div>

            <p className="text-xs text-gray-400 text-center mt-1.5">
              {supported
                ? 'Hold mic or Spacebar to speak · Enter to send · Shift+Enter for new line'
                : 'Enter to send · Shift+Enter for new line'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * components/ChatArea/index.tsx
 *
 * The main conversation panel. Renders the message history, the auto-expanding
 * input field, the send button, and the microphone button for voice dictation.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { Mic, MicOff, Plus, ArrowUp, ChevronDown, ChevronUp, Image as ImageIcon, FileText, BookOpen } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { AttachmentChip } from './AttachmentChip';
import { VoiceWaveform } from './VoiceWaveform';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import type { ChatDetail, LocalAttachment, WordPopup } from '../../types';

interface Props {
  chat: ChatDetail | null;
  loading: boolean;
  streaming: boolean;
  onSendMessage: (content: string, attachments: LocalAttachment[]) => Promise<void>;
  onWordRightClick: (popup: WordPopup) => void;
  onSelectChat: (id: string) => void;
  // "Upload file" im Plus-Menü: bindet ein PDF an den Chat tree (ein PDF pro
  // Tree, ADR-0002). Ohne Handler wird der Menüeintrag nicht angeboten.
  onUploadPdf?: (file: File) => void;
  // "Research paper" im Plus-Menü: öffnet das Paper-Such-Modal (Slice 07).
  // Ohne Handler wird der Menüeintrag nicht angeboten.
  onOpenPaperSearch?: () => void;
}

// Wählt eine Alias-Basis je nach MIME-Typ — z. B. "@foto" für Bilder.
function aliasBaseFor(mimetype: string): string {
  if (mimetype.startsWith('image/')) return '@foto';
  if (mimetype.startsWith('text/') || mimetype === 'application/json') return '@text';
  return '@datei';
}

// How close to the bottom (in px) counts as "at the bottom" — used to re-pin
// auto-scroll once the user manually scrolls back down.
const AT_BOTTOM_THRESHOLD = 8;

export function ChatArea({ chat, loading, streaming, onSendMessage, onWordRightClick, onSelectChat, onUploadPdf, onOpenPaperSearch }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  // @-Autocomplete: enthält den aktuell getippten Filter-String, oder null wenn kein @-Modus.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Markiert den aktuell hervorgehobenen Vorschlag im Autocomplete-Dropdown.
  const [mentionIndex, setMentionIndex] = useState(0);
  // Steuert das kleine Plus-Popover-Menü ("Files and media", …) — wie bei Claude.
  const [pickerMenuOpen, setPickerMenuOpen] = useState(false);
  const pickerMenuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  // Mirror state for rendering the "scroll to latest" button.
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  // Authoritative pin state read by the auto-scroll effect. A ref avoids
  // race conditions where a stale state value could pull the user back down
  // a moment after they started scrolling up.
  const isPinnedRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const chatColumnClass = 'shrink-0 px-6 sm:px-8';
  const chatColumnStyle = { width: '46rem', maxWidth: 'calc(100% - 3rem)' };

  // "Branched from"-Zitat: standardmäßig auf 2 Zeilen geklemmt; der Chevron
  // klappt den vollen Text auf. Der Chevron erscheint nur, wenn das Zitat
  // wirklich abgeschnitten ist — gemessen per ResizeObserver, damit das auch
  // beim Verbreitern der Chat-Spalte (Drag-Resize) stimmt.
  const [branchQuoteExpanded, setBranchQuoteExpanded] = useState(false);
  const [branchQuoteOverflows, setBranchQuoteOverflows] = useState(false);
  const branchQuoteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setBranchQuoteExpanded(false);
  }, [chat?.id]);
  useEffect(() => {
    const el = branchQuoteRef.current;
    if (!el) return;
    const measure = () => {
      // Im aufgeklappten Zustand nicht messen — sonst verschwände der
      // Chevron und man könnte nie wieder zuklappen.
      if (!branchQuoteExpanded) {
        setBranchQuoteOverflows(el.scrollHeight > el.clientHeight + 1);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chat?.id, chat?.parent_word, branchQuoteExpanded]);

  // onTranscript wird erst beim Stoppen aufgerufen, mit dem gesammelten Text —
  // wir hängen ihn ans Eingabefeld an (oder schreiben ihn rein, wenn leer).
  const { isListening, volume, supported, startListening, stopListening } = useVoiceInput({
    onTranscript: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setInput(prev => (prev ? prev + ' ' + trimmed : trimmed));
    },
  });

  const handleToggleListening = () => {
    if (isListening) stopListening();
    else startListening();
  };

  const setPinned = (pinned: boolean) => {
    isPinnedRef.current = pinned;
    setIsPinnedToBottom(pinned);
  };

  // Pin/unpin logic uses two signals:
  //   (1) `scroll` event — for re-pinning when the user scrolls back to the
  //       bottom on their own. Not reliable for *detecting* user input during
  //       streaming because it also fires for our own programmatic scrollIntoView
  //       and races against rapid delta updates.
  //   (2) `wheel` + `touchmove` events — fired the instant the user expresses
  //       intent to scroll. We use these to unpin immediately, before any
  //       potential auto-scroll can yank them back down.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // Only re-pin here (when user reaches the bottom). Unpinning is owned by
      // the wheel/touch handlers below, so this never fights the user's input.
      if (distanceFromBottom < AT_BOTTOM_THRESHOLD) {
        setPinned(true);
      }
    };

    // Wheel (mouse + trackpad): negative deltaY means scrolling up.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) setPinned(false);
    };

    // Touch: track the previous Y so we can tell direction. Moving the finger
    // down on screen scrolls the content up, which is what we want to catch.
    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const curY = e.touches[0]?.clientY ?? 0;
      if (curY > lastTouchY) setPinned(false);
      lastTouchY = curY;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
    // Depend on chat?.id so the listeners get attached as soon as a chat
    // actually mounts the scroll container. Without this dep, the effect
    // runs once on the empty-state render (when scrollContainerRef.current
    // is null because of the early `if (!chat) return ...` above) and never
    // again — leaving wheel/touch unpinning permanently broken.
  }, [chat?.id]);

  // Auto-scroll on new content only when the user hasn't scrolled away.
  useEffect(() => {
    if (isPinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [chat?.messages, streaming]);

  // Reset to pinned when the user opens a different chat.
  useEffect(() => {
    setPinned(true);
  }, [chat?.id]);

  const scrollToBottom = () => {
    setPinned(true);
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
    // Während der Aufnahme nicht senden — User muss erst stoppen, damit das
    // Transkript fertig ans Eingabefeld angehängt wird.
    if (isListening) return;
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || !chat) return;
    const sentAttachments = attachments;
    setInput('');
    setAttachments([]);
    setMentionQuery(null);
    setSending(true);
    try {
      await onSendMessage(text, sentAttachments);
    } finally {
      setSending(false);
      sentAttachments.forEach(a => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Wenn das Mention-Dropdown gerade Vorschläge zeigt, übernimmt die Tastatur
    // die Navigation: Pfeiltasten blättern, Enter wählt, Escape schließt.
    const mentionsOpen = mentionQuery !== null && filteredMentions.length > 0;
    if (mentionsOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => (i + 1) % filteredMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => (i - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const chosen = filteredMentions[mentionIndex] ?? filteredMentions[0];
        if (chosen) insertMention(chosen.alias);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Plus-Button → kleines Popover-Menü öffnen (statt direkt File-Picker).
  const handleTogglePickerMenu = () => {
    setPickerMenuOpen(prev => !prev);
  };

  // Klick auf "Files and media" im Popover → System-File-Picker öffnen.
  const handlePickFiles = () => {
    setPickerMenuOpen(false);
    fileInputRef.current?.click();
  };

  // Klick auf "Upload file" im Popover → PDF-Picker öffnen; die gewählte
  // Datei geht an onUploadPdf (Paper-Upload), nicht in die Message-Anhänge.
  const handlePickPdf = () => {
    setPickerMenuOpen(false);
    pdfInputRef.current?.click();
  };

  const handlePdfSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadPdf) onUploadPdf(file);
    if (pdfInputRef.current) pdfInputRef.current.value = '';
  };

  // Popover schließt sich, sobald irgendwo außerhalb geklickt wird.
  useEffect(() => {
    if (!pickerMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (pickerMenuRef.current?.contains(target)) return;
      if (plusButtonRef.current?.contains(target)) return;
      setPickerMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerMenuOpen]);

  // Wenn der User Dateien auswählt: in lokale Anhänge umwandeln, automatisch @-Aliase vergeben.
  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setAttachments(prev => {
      const next = [...prev];
      for (const file of files) {
        // Nächste freie Nummer pro Alias-Basis ermitteln
        const base = aliasBaseFor(file.type);
        const existing = next
          .map(a => a.alias)
          .filter(a => a.startsWith(base))
          .map(a => parseInt(a.slice(base.length), 10))
          .filter(n => !isNaN(n));
        const nextN = existing.length > 0 ? Math.max(...existing) + 1 : 1;
        const alias = `${base}${nextN}`;
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        next.push({ alias, file, previewUrl });
      }
      return next;
    });
    // Input zurücksetzen, damit dieselbe Datei nochmal gewählt werden kann
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments(prev => {
      const att = prev[idx];
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // Bringt einen rohen User-Eingabe-String in eine gültige Alias-Form:
  // - sicheres "@" am Anfang
  // - Whitespace → Underscore (damit der Alias als ein Token im Text steht)
  // - keine zusätzlichen "@" innerhalb des Namens
  const normalizeAlias = (raw: string): string => {
    const trimmed = raw.trim();
    const withoutAt = trimmed.replace(/^@+/, '');
    const collapsed = withoutAt.replace(/\s+/g, '_').replace(/@/g, '');
    return '@' + collapsed;
  };

  const handleRenameAttachment = (idx: number, rawNew: string) => {
    setAttachments(prev => {
      const oldAlias = prev[idx]?.alias;
      if (!oldAlias) return prev;
      const normalized = normalizeAlias(rawNew);
      if (normalized === '@' || normalized === oldAlias) return prev;
      const others = prev.filter((_, i) => i !== idx).map(a => a.alias);
      let finalAlias = normalized;
      if (others.includes(finalAlias)) {
        let n = 2;
        while (others.includes(`${normalized}_${n}`)) n++;
        finalAlias = `${normalized}_${n}`;
      }
      // Eingabefeld synchron halten: alle Vorkommen des alten Alias durch den neuen
      // ersetzen — aber nur als ganzes Token (kein Treffer in "@foto10" für "@foto").
      setInput(input => {
        const escaped = oldAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped + '(?=\\W|$)', 'g');
        return input.replace(re, finalAlias);
      });
      return prev.map((a, i) => (i === idx ? { ...a, alias: finalAlias } : a));
    });
  };

  // @-Autocomplete: prüft, ob der Cursor gerade hinter einem unvollständigen @-Token steht.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursor = e.target.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return attachments.filter(a => a.alias.slice(1).toLowerCase().startsWith(q));
  }, [attachments, mentionQuery]);

  // Bei jeder Änderung der Vorschlagsliste den Highlight-Index zurücksetzen,
  // damit immer der erste Vorschlag aktiv ist und nie ein Out-of-Bounds-Index entsteht.
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, filteredMentions.length]);

  const insertMention = (alias: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? input.length;
    const before = input.slice(0, cursor);
    const after = input.slice(cursor);
    const replaced = before.replace(/@\w*$/, alias + ' ');
    const newValue = replaced + after;
    setInput(newValue);
    setMentionQuery(null);
    // Cursor hinter den eingefügten Alias setzen
    requestAnimationFrame(() => {
      const pos = replaced.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
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
      {/* Header: chat title. Bei Branch-Chats entfällt er komplett — der
          Titel ("About: <Auswahl>") wäre nur eine Dublette des aufklappbaren
          "Branched from"-Zitats direkt darunter. */}
      {!(chat.parent_word && chat.parent_id) && (
        <div className="border-b border-gray-100 bg-white">
          <div className="flex justify-center">
            <div className={`${chatColumnClass} py-7`} style={chatColumnStyle} data-testid="chat-header-shell">
              <h2 className="font-semibold text-gray-900 text-base break-words line-clamp-2" title={chat.title}>
                {chat.title}
              </h2>
            </div>
          </div>
        </div>
      )}

      {/* Message list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="flex justify-center">
          <div
            className={`${chatColumnClass} flex flex-col py-8`}
            style={chatColumnStyle}
            data-testid="chat-content-shell"
          >
            {/* Blue hyperlink back to parent chat — shown at the top of
                branched chats. The quote is the user's original PDF/chat
                selection and can be a whole sentence: clamped to two lines,
                expandable via the chevron (only shown when actually cut). */}
            {chat.parent_word && chat.parent_id && (
              <div className="flex w-full min-w-0 items-start gap-1.5 border-b border-gray-100 pb-3 mb-6 text-sm">
                <span className="material-icons mt-0.5 shrink-0 text-[14px] text-gray-400">subdirectory_arrow_left</span>
                <div
                  ref={branchQuoteRef}
                  className={`min-w-0 flex-1 break-words leading-relaxed ${branchQuoteExpanded ? '' : 'line-clamp-2'}`}
                  data-testid="branched-from-quote"
                >
                  <span className="text-gray-400">Branched from </span>
                  {/* Kein <button>: Buttons sind atomare Inline-Blöcke, die
                      weder über Zeilen umbrechen noch sich clampen lassen —
                      das Zitat wäre wieder einzeilig abgeschnitten. Ein
                      inline-<span> mit Link-Semantik bricht sauber um. */}
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={() => onSelectChat(chat.parent_id!)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectChat(chat.parent_id!);
                      }
                    }}
                    className="cursor-pointer text-blue-600 underline underline-offset-2 hover:text-blue-800 font-medium transition-colors"
                  >
                    "{chat.parent_word}"
                  </span>
                </div>
                {(branchQuoteOverflows || branchQuoteExpanded) && (
                  <button
                    onClick={() => setBranchQuoteExpanded(v => !v)}
                    title={branchQuoteExpanded ? 'Show less' : 'Show full text'}
                    aria-expanded={branchQuoteExpanded}
                    data-testid="branched-from-toggle"
                    className="mt-0.5 shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  >
                    {branchQuoteExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
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

      {/* "Scroll to bottom" button — only shown when the user has scrolled up
          away from the latest message. Lets them jump back in one click. */}
      {!isPinnedToBottom && (
        <button
          onClick={scrollToBottom}
          title="Scroll to latest"
          className="absolute left-1/2 -translate-x-1/2 bottom-32 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white border border-gray-200 text-gray-600 shadow-md hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <ChevronDown size={18} strokeWidth={2} />
        </button>
      )}

      {/* Input area — full width */}
      <div className="bg-white pb-6 pt-3 relative">
        <div className="flex justify-center">
          <div className={`${chatColumnClass} @container`} style={chatColumnStyle} data-testid="chat-input-shell">
            {/* Anhang-Chips über dem Eingabefeld */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 px-2">
                {attachments.map((att, i) => (
                  <AttachmentChip
                    key={`${att.alias}-${i}`}
                    alias={att.alias}
                    filename={att.file.name}
                    mimetype={att.file.type}
                    previewUrl={att.previewUrl}
                    onRemove={() => handleRemoveAttachment(i)}
                    onRename={(newAlias) => handleRenameAttachment(i, newAlias)}
                  />
                ))}
              </div>
            )}

            {/* @-Autocomplete-Dropdown: erscheint, wenn der User "@" tippt */}
            {mentionQuery !== null && filteredMentions.length > 0 && (
              <div className="absolute bottom-[112px] left-1/2 -translate-x-1/2 z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden w-[28rem] max-w-[calc(100%-3rem)]">
                <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-gray-400 font-medium border-b border-gray-100">
                  Anhänge
                </div>
                {filteredMentions.map((att, i) => (
                  <button
                    key={att.alias}
                    onClick={() => insertMention(att.alias)}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2 transition-colors text-left ${
                      i === mentionIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                    }`}
                    data-testid={`mention-item-${att.alias}`}
                  >
                    <AttachmentChip
                      alias={att.alias}
                      filename={att.file.name}
                      mimetype={att.file.type}
                      previewUrl={att.previewUrl}
                      compact
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Sprach-Wellen — eigene Zeile ÜBER dem Eingabefeld, damit das
                Eingabefeld nicht größer wird, sondern in Ruhe bleibt. */}
            {isListening && (
              <div className="mb-2 px-3" data-testid="voice-waveform-row">
                <VoiceWaveform volume={volume} />
              </div>
            )}

            <div className={`flex items-center gap-2 bg-white border border-gray-300 rounded-full pl-2 pr-3 py-2 shadow-sm transition-all ${
              isListening
                ? 'border-red-300 ring-2 ring-red-100'
                : 'focus-within:border-gray-400'
            }`}>
              {/* Hidden File-Input — wird vom Plus-Button getriggert */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
                accept="image/*,text/*,.pdf,.md,.txt,.csv,.json"
              />
              {/* Verstecktes PDF-Input für "Upload file" (Paper an den Tree binden) */}
              <input
                ref={pdfInputRef}
                type="file"
                onChange={handlePdfSelected}
                className="hidden"
                accept="application/pdf,.pdf"
                data-testid="pdf-file-input"
              />
              <div className="relative shrink-0">
                <button
                  ref={plusButtonRef}
                  onClick={handleTogglePickerMenu}
                  disabled={isBusy}
                  aria-haspopup="menu"
                  aria-expanded={pickerMenuOpen}
                  className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    pickerMenuOpen
                      ? 'text-gray-900 bg-gray-100'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  title="Anhängen"
                  data-testid="attach-plus-button"
                >
                  <Plus size={20} strokeWidth={1.75} />
                </button>
                {pickerMenuOpen && (
                  <div
                    ref={pickerMenuRef}
                    role="menu"
                    className="absolute bottom-full left-0 mb-2 z-30 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden min-w-[14rem] py-1"
                    data-testid="attach-menu"
                  >
                    <button
                      role="menuitem"
                      onClick={handlePickFiles}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left text-sm text-gray-800"
                      data-testid="attach-menu-files"
                    >
                      <ImageIcon size={16} className="text-gray-500 shrink-0" />
                      <span>Media</span>
                    </button>
                    {onUploadPdf && (
                      <button
                        role="menuitem"
                        onClick={handlePickPdf}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left text-sm text-gray-800"
                        data-testid="attach-menu-upload-pdf"
                      >
                        <FileText size={16} className="text-gray-500 shrink-0" />
                        <span>PDF</span>
                      </button>
                    )}
                    {onOpenPaperSearch && (
                      <button
                        role="menuitem"
                        onClick={() => { setPickerMenuOpen(false); onOpenPaperSearch(); }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left text-sm text-gray-800"
                        data-testid="attach-menu-research-paper"
                      >
                        <BookOpen size={16} className="text-gray-500 shrink-0" />
                        <span>Research paper</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Der native Textarea-Platzhalter kann in schmalen Spalten
                  weder umbrechen (sah abgeschnitten aus) noch mit Ellipse
                  kürzen (Chromium ignoriert text-overflow auf Textarea-
                  Platzhaltern). Darum bleibt das placeholder-Attribut nur
                  für Screenreader/Tests, unsichtbar — sichtbar ist das
                  Overlay-Span, das sauber mit „…" kürzt. */}
              <div className="relative flex-1 min-w-0 flex">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? '' : 'Ask anything'}
                  rows={1}
                  disabled={isBusy}
                  readOnly={isListening}
                  className="min-h-[44px] w-full min-w-0 bg-transparent px-2 py-[10px] text-[16px] text-gray-900 outline-none resize-none leading-[1.5] disabled:opacity-50 placeholder:text-transparent placeholder:whitespace-nowrap placeholder:overflow-hidden"
                  data-testid="chat-textarea"
                />
                {!input && !isListening && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 max-w-[calc(100%-1rem)] truncate text-[16px] leading-[1.5] text-gray-400"
                    data-testid="chat-textarea-placeholder"
                  >
                    Ask anything
                  </span>
                )}
              </div>

              {/* In sehr schmalen Spalten (Branch-Chat neben dem PDF) hat das
                  Mockup keinen Mikro-Knopf — ausblenden, damit der Platzhalter
                  und die Eingabe genug Breite behalten. */}
              {supported && (
                <button
                  onClick={handleToggleListening}
                  title={isListening ? 'Aufnahme beenden' : 'Aufnahme starten'}
                  aria-pressed={isListening}
                  className={`shrink-0 w-9 h-9 @max-[24rem]:hidden flex items-center justify-center rounded-full transition-colors ${
                    isListening
                      ? 'text-white bg-red-500 hover:bg-red-600'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  data-testid="mic-button"
                >
                  {isListening ? <MicOff size={20} strokeWidth={1.9} /> : <Mic size={20} strokeWidth={1.9} />}
                </button>
              )}

              <button
                onClick={handleSend}
                disabled={isBusy || isListening || (!input.trim() && attachments.length === 0)}
                title="Send"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 text-white transition-all hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUp size={20} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

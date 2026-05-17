/**
 * components/Sidebar/index.tsx
 *
 * Two-level navigation sidebar with a white background.
 *
 * Default view: flat list of all root chats.
 * Expanded view: back button + one root chat with all its children.
 *
 * Clicking a root chat expands it and opens it in the chat area.
 * The "← All chats" button returns to the flat root list.
 *
 * Right-clicking any chat opens a context menu with rename / delete options.
 * Hovering shows the full chat title as a native tooltip.
 */

import { useState, useEffect } from 'react';
import { SquarePen, GitBranch, ArrowLeft, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { ChatTree, RenameInput } from './ChatTree';
import { Logo } from '../Logo';
import { SettingsModal } from '../SettingsModal';
import type { Chat, Settings as AppSettings } from '../../types';

// Recursively look up a chat by id so the delete confirmation can show its title.
function findChatById(chats: Chat[], id: string): Chat | null {
  for (const c of chats) {
    if (c.id === id) return c;
    if (c.children) {
      const inChildren = findChatById(c.children, id);
      if (inChildren) return inChildren;
    }
  }
  return null;
}

interface ContextMenuState {
  chatId: string;
  x: number;
  y: number;
}

interface Props {
  chats: Chat[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  viewMode: 'chat' | 'mindmap';
  onToggleView: () => void;
  // Current LLM settings — null while still loading. Shown in the footer so the
  // user always sees which provider/model is active.
  settings: AppSettings | null;
  onSettingsChange: (s: AppSettings) => void;
}

export function Sidebar({ chats, activeChatId, onSelect, onNewChat, onDelete, onRename, viewMode, onToggleView, settings, onSettingsChange }: Props) {
  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const expandedRoot = expandedRootId ? chats.find(c => c.id === expandedRootId) ?? null : null;
  const pendingDeleteChat = pendingDeleteId ? findChatById(chats, pendingDeleteId) : null;

  // Close the context menu on any outside click or Escape press.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleRootClick = (id: string) => {
    setExpandedRootId(id);
    onSelect(id);
  };

  const openContextMenu = (chatId: string, x: number, y: number) =>
    setContextMenu({ chatId, x, y });

  const requestDelete = (id: string) => setPendingDeleteId(id);

  const confirmDelete = () => {
    if (pendingDeleteId) onDelete(pendingDeleteId);
    setPendingDeleteId(null);
  };

  const handleRenameSubmit = (id: string, title: string) => {
    onRename(id, title);
    setRenamingId(null);
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
      {/* Top bar: app name + action icons */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100">
        <Logo width={120} />
        <div className="flex items-center gap-2">
          {/* Mind map toggle — only meaningful with an active chat, so hide on the
              empty "homepage" state and show as soon as a chat is selected. */}
          {activeChatId && (
            <button
              onClick={onToggleView}
              title={viewMode === 'chat' ? 'Switch to Mind Map' : 'Switch to Chat'}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'mindmap'
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <GitBranch size={16} />
            </button>
          )}

          {/* New chat button */}
          <button
            onClick={onNewChat}
            title="New Chat"
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <SquarePen size={16} />
          </button>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={onSettingsChange}
      />

      {/* Right-click context menu (rename / delete). Positioned at cursor. */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => { setRenamingId(contextMenu.chatId); setContextMenu(null); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            <Pencil size={13} />
            Rename
          </button>
          <button
            onClick={() => { requestDelete(contextMenu.chatId); setContextMenu(null); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-gray-100"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}

      {/* Delete-confirmation modal */}
      {pendingDeleteChat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPendingDeleteId(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-2">
              <h3 className="text-base font-semibold text-gray-900 mb-1.5">Delete chat?</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                "{pendingDeleteChat.title}" and all its branched chats will be permanently removed.
              </p>
            </div>
            <div className="flex gap-2 px-6 pb-5 pt-4 justify-end">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-6 pt-2">
        {chats.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-8 px-4">No chats yet</p>
        ) : expandedRoot ? (
          // Expanded view: back button + single root with all children
          <>
            <button
              onClick={() => setExpandedRootId(null)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 px-2.5 py-1.5 mb-2 rounded-md hover:bg-gray-100 transition-colors w-full"
            >
              <ArrowLeft size={13} />
              All chats
            </button>
            <ChatTree
              chats={[expandedRoot]}
              activeChatId={activeChatId}
              renamingId={renamingId}
              onSelect={onSelect}
              onContextMenu={openContextMenu}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={() => setRenamingId(null)}
            />
          </>
        ) : (
          // Default view: flat list of root chats (no children shown)
          <>
            <p className="text-[11px] text-gray-400 font-medium px-2.5 pt-2 pb-1 uppercase tracking-wider">Chats</p>
            <div className="space-y-0.5">
              {chats.map(chat => {
                const isActive = chat.id === activeChatId ||
                  !!(chat.children?.some(c => c.id === activeChatId));
                const isRenaming = chat.id === renamingId;
                return (
                  <div
                    key={chat.id}
                    onClick={() => !isRenaming && handleRootClick(chat.id)}
                    onContextMenu={e => {
                      e.preventDefault();
                      openContextMenu(chat.id, e.clientX, e.clientY);
                    }}
                    title={isRenaming ? undefined : chat.title}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    {isRenaming ? (
                      <RenameInput
                        initial={chat.title}
                        onSubmit={title => handleRenameSubmit(chat.id, title)}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <span className="flex-1 truncate text-[13px]">{chat.title}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer: active-model picker pinned to the bottom.
          Looks like a dropdown so the user immediately reads it as
          "this is what's running — click to change", not as passive status. */}
      {settings && (
        <div className="border-t border-gray-100 px-3 py-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-1.5">
            Active model
          </p>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Change model"
            aria-label="Change active model"
            className="group flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors text-left"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                settings.llm_provider === 'ollama' ? 'bg-green-500' : 'bg-blue-500'
              }`}
              aria-hidden="true"
            />
            <span className="flex-1 min-w-0 text-sm">
              <span className="font-medium text-gray-800">
                {settings.llm_provider === 'ollama' ? 'Ollama' : 'OpenAI'}
              </span>
              <span className="text-gray-500"> · </span>
              <span className="text-gray-500 truncate">
                {settings.llm_provider === 'ollama' ? settings.ollama_model : settings.openai_model}
              </span>
            </span>
            <ChevronDown size={14} className="text-gray-400 group-hover:text-gray-600 shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
}

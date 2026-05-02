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
 */

import { useState } from 'react';
import { SquarePen, GitBranch, ArrowLeft, Trash2 } from 'lucide-react';
import { ChatTree } from './ChatTree';
import { Logo } from '../Logo';
import type { Chat } from '../../types';

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

interface Props {
  chats: Chat[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  viewMode: 'chat' | 'mindmap';
  onToggleView: () => void;
}

export function Sidebar({ chats, activeChatId, onSelect, onNewChat, onDelete, viewMode, onToggleView }: Props) {
  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const expandedRoot = expandedRootId ? chats.find(c => c.id === expandedRootId) ?? null : null;
  const pendingDeleteChat = pendingDeleteId ? findChatById(chats, pendingDeleteId) : null;

  const handleRootClick = (id: string) => {
    setExpandedRootId(id);
    onSelect(id);
  };

  // Intercept ChatTree / root-row deletes: open the confirmation dialog rather
  // than deleting immediately, so the user can't accidentally lose a chat.
  const requestDelete = (id: string) => setPendingDeleteId(id);

  const confirmDelete = () => {
    if (pendingDeleteId) onDelete(pendingDeleteId);
    setPendingDeleteId(null);
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
      {/* Top bar: app name + action icons */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100">
        <Logo width={120} />
        <div className="flex items-center gap-2">
          {/* Mind map / chat view toggle */}
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
              onSelect={onSelect}
              onDelete={requestDelete}
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
                return (
                  <div
                    key={chat.id}
                    onClick={() => handleRootClick(chat.id)}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors group ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span className="flex-1 truncate text-[13px]">{chat.title}</span>
                    <button
                      onClick={e => { e.stopPropagation(); requestDelete(chat.id); }}
                      title="Delete chat"
                      className="shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

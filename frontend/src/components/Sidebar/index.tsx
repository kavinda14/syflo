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
import { SquarePen, GitBranch, ArrowLeft, Pencil, Trash2, ChevronDown, FileText } from 'lucide-react';
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
  // May be async — returns a Promise so the sidebar can await it and surface
  // any failure (e.g. backend unreachable) in the confirmation modal.
  onDelete: (id: string) => void | Promise<void>;
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

  // Close the context menu on Escape. Outside clicks are handled by the
  // backdrop element rendered below the menu — that's more reliable than a
  // window listener, which can race with the buttons' own onClick handlers
  // (React stopPropagation doesn't always stop native DOM bubbling).
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contextMenu]);

  const handleRootClick = (id: string) => {
    setExpandedRootId(id);
    onSelect(id);
  };

  const openContextMenu = (chatId: string, x: number, y: number) =>
    setContextMenu({ chatId, x, y });

  const requestDelete = (id: string) => setPendingDeleteId(id);

  // Await onDelete (which hits the backend) before closing the modal — that
  // way, if the backend call fails, the parent can surface the error and the
  // modal stays open so the user can retry. Closing optimistically used to
  // hide silent fetch failures (e.g. when the dev server was down).
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(pendingDeleteId);
      setPendingDeleteId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the chat. Is the backend running?');
    } finally {
      setDeleting(false);
    }
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

      {/* Right-click context menu (rename / delete). Positioned at cursor.
          An invisible full-screen backdrop sits at z-40 to capture outside
          clicks reliably — the menu itself is at z-50, so its button clicks
          can never hit the backdrop and never race with a window listener. */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
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
        </>
      )}

      {/* Delete-confirmation modal */}
      {pendingDeleteChat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!deleting) { setPendingDeleteId(null); setDeleteError(null); } }}
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
              {deleteError && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md border border-red-100">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex gap-2 px-6 pb-5 pt-4 justify-end">
              <button
                onClick={() => { setPendingDeleteId(null); setDeleteError(null); }}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : deleteError ? 'Retry' : 'Delete'}
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
                    {/* PDF tag on trees with a bound paper — same badge as on
                        the tree's root node (design/mockup-pdf-layout.html) */}
                    {!isRenaming && chat.paper_id && (
                      <span
                        className="ml-auto shrink-0 inline-flex items-center gap-[3px] text-[10px] font-semibold tracking-wide text-gray-500 bg-gray-50 border border-gray-200 rounded-[5px] px-1.5 py-px"
                        data-testid="root-list-pdf-tag"
                      >
                        <FileText size={9} />
                        PDF
                      </span>
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

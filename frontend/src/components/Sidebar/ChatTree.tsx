/**
 * components/Sidebar/ChatTree.tsx
 *
 * Recursively renders the chat hierarchy as an indented tree.
 * Used in the expanded sidebar view to show a root chat and all its children.
 *
 * Interactions:
 * - Click a node to open that chat in the main area
 * - Click the chevron to expand / collapse children
 * - Right-click to open the context menu (rename / delete)
 * - Hover to see the full title in a native tooltip
 * - When a node is being renamed, its title is replaced by an inline input
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { Chat } from '../../types';

interface Props {
  chats: Chat[];
  activeChatId: string | null;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRenameSubmit: (id: string, title: string) => void;
  onRenameCancel: () => void;
}

function TreeNode({ chat, activeChatId, renamingId, onSelect, onContextMenu, onRenameSubmit, onRenameCancel }: {
  chat: Chat;
  activeChatId: string | null;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRenameSubmit: (id: string, title: string) => void;
  onRenameCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = chat.children && chat.children.length > 0;
  const isActive = chat.id === activeChatId;
  const isRenaming = chat.id === renamingId;

  return (
    <div>
      {/* Chat row */}
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 mb-0.5 rounded-md cursor-pointer transition-colors text-sm ${
          isActive
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
        }`}
        onClick={() => !isRenaming && onSelect(chat.id)}
        onContextMenu={e => {
          e.preventDefault();
          onContextMenu(chat.id, e.clientX, e.clientY);
        }}
        title={isRenaming ? undefined : chat.title}
      >
        {/* Expand/collapse chevron for nodes with children */}
        {hasChildren ? (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 text-gray-400 hover:text-gray-700"
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}

        {/* Chat title — replaced by an inline input while this row is being renamed */}
        {isRenaming ? (
          <RenameInput
            initial={chat.title}
            onSubmit={title => onRenameSubmit(chat.id, title)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="flex-1 truncate text-[13px]">{chat.title}</span>
        )}
      </div>

      {/* Recursively render child chats when expanded.
          Connector lines (design/mockup-paper-view.html): each child row gets a
          horizontal elbow back to a vertical trunk under the parent. The trunk
          segment is anchored per child wrapper — full height for non-last
          siblings (spans their subtree), stopping at the row middle for the
          last sibling so no line dangles below it. */}
      {hasChildren && expanded && (
        <div className="relative pl-[22px]">
          {chat.children!.map((child, i) => {
            const isLast = i === chat.children!.length - 1;
            return (
              <div key={child.id} className="relative">
                <span
                  data-testid={isLast ? 'tree-trunk-end' : 'tree-trunk'}
                  className="absolute w-px bg-slate-300 pointer-events-none"
                  style={isLast ? { left: -8, top: -2, height: 18 } : { left: -8, top: -2, bottom: 0 }}
                />
                <span
                  data-testid="tree-elbow"
                  className="absolute h-px bg-slate-300 pointer-events-none"
                  style={{ left: -8, top: 16, width: 14 }}
                />
                <TreeNode
                  chat={child}
                  activeChatId={activeChatId}
                  renamingId={renamingId}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
                  onRenameSubmit={onRenameSubmit}
                  onRenameCancel={onRenameCancel}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Inline editor used both in ChatTree and the flat root list. Lives here because
// both lists mount it the same way; extracting it would just add an import.
export function RenameInput({ initial, onSubmit, onCancel }: {
  initial: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={commit}
      className="flex-1 min-w-0 bg-white border border-blue-400 rounded px-1.5 py-0.5 text-[13px] text-gray-900 outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}

export function ChatTree({ chats, activeChatId, renamingId, onSelect, onContextMenu, onRenameSubmit, onRenameCancel }: Props) {
  return (
    <div>
      {chats.map(chat => (
        <TreeNode
          key={chat.id}
          chat={chat}
          activeChatId={activeChatId}
          renamingId={renamingId}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </div>
  );
}

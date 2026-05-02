/**
 * components/Sidebar/ChatTree.tsx
 *
 * Recursively renders the chat hierarchy as an indented tree.
 * Used in the expanded sidebar view to show a root chat and all its children.
 *
 * Interactions:
 * - Click a node to open that chat in the main area
 * - Click the chevron to expand / collapse children
 * - Hover to reveal the delete button (trash icon)
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import type { Chat } from '../../types';

interface Props {
  chats: Chat[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  depth?: number;
}

function TreeNode({ chat, activeChatId, onSelect, onDelete, depth = 0 }: {
  chat: Chat;
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = chat.children && chat.children.length > 0;
  const isActive = chat.id === activeChatId;

  return (
    <div>
      {/* Chat row */}
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 mb-0.5 rounded-md cursor-pointer group transition-colors text-sm ${
          isActive
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
        }`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => onSelect(chat.id)}
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

        {/* Chat title */}
        <span className="flex-1 truncate text-[13px]">{chat.title}</span>

        {/* Delete button: only visible while the cursor hovers the row. */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(chat.id); }}
          title="Delete chat"
          className="shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Recursively render child chats when expanded */}
      {hasChildren && expanded && (
        <div>
          {chat.children!.map(child => (
            <TreeNode
              key={child.id}
              chat={child}
              activeChatId={activeChatId}
              onSelect={onSelect}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatTree({ chats, activeChatId, onSelect, onDelete }: Props) {
  return (
    <div>
      {chats.map(chat => (
        <TreeNode
          key={chat.id}
          chat={chat}
          activeChatId={activeChatId}
          onSelect={onSelect}
          onDelete={onDelete}
          depth={0}
        />
      ))}
    </div>
  );
}

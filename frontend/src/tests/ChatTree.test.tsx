/**
 * ChatTree.test.tsx
 *
 * Tests for the ChatTree and TreeNode components that render the hierarchical
 * chat list inside the dark sidebar.
 * Covers: rendering, expand/collapse, chat selection, deletion, and the
 * parent_word badge shown on branched chats.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatTree } from '../components/Sidebar/ChatTree';
import type { Chat } from '../types';

const flatChats: Chat[] = [
  { id: '1', title: 'Alpha', parent_id: null, parent_word: null, created_at: '', children: [] },
  { id: '2', title: 'Beta', parent_id: null, parent_word: null, created_at: '', children: [] },
];

const nestedChats: Chat[] = [
  {
    id: '1',
    title: 'Parent Chat',
    parent_id: null,
    parent_word: null,
    created_at: '',
    children: [
      { id: '2', title: 'Child Chat', parent_id: '1', parent_word: 'quantum', created_at: '', children: [] },
    ],
  },
];

describe('ChatTree – rendering', () => {
  it('renders all root-level chat titles', () => {
    render(<ChatTree chats={flatChats} activeChatId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders child chats', () => {
    render(<ChatTree chats={nestedChats} activeChatId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Parent Chat')).toBeInTheDocument();
    expect(screen.getByText('Child Chat')).toBeInTheDocument();
  });

  it('does NOT show the parent_word badge — removed for a cleaner sidebar', () => {
    render(<ChatTree chats={nestedChats} activeChatId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('quantum')).not.toBeInTheDocument();
  });

  it('highlights the active chat', () => {
    render(<ChatTree chats={flatChats} activeChatId="1" onSelect={vi.fn()} onDelete={vi.fn()} />);
    const activeRow = screen.getByText('Alpha').closest('div');
    expect(activeRow?.className).toContain('bg-blue-50');
  });

  it('does not highlight inactive chats', () => {
    render(<ChatTree chats={flatChats} activeChatId="1" onSelect={vi.fn()} onDelete={vi.fn()} />);
    const inactiveRow = screen.getByText('Beta').closest('div');
    expect(inactiveRow?.className).not.toContain('bg-blue-50');
  });
});

describe('ChatTree – interactions', () => {
  it('calls onSelect with the correct id when a chat is clicked', () => {
    const onSelect = vi.fn();
    render(<ChatTree chats={flatChats} activeChatId={null} onSelect={onSelect} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('calls onDelete when the delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<ChatTree chats={flatChats} activeChatId={null} onSelect={vi.fn()} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByTitle('Delete chat');
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith('1');
  });

  it('does not call onSelect when the delete button is clicked', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<ChatTree chats={flatChats} activeChatId={null} onSelect={onSelect} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByTitle('Delete chat');
    fireEvent.click(deleteButtons[0]);
    // stopPropagation prevents the row click from also firing
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('ChatTree – expand / collapse', () => {
  it('shows child chats by default (expanded)', () => {
    render(<ChatTree chats={nestedChats} activeChatId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Child Chat')).toBeInTheDocument();
  });

  it('hides child chats after clicking the collapse chevron', () => {
    render(<ChatTree chats={nestedChats} activeChatId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    // The chevron button is the first button in the parent row
    const chevronButtons = screen.getAllByRole('button');
    const chevron = chevronButtons.find(btn =>
      btn.closest('div')?.textContent?.includes('Parent Chat')
    );
    fireEvent.click(chevron!);
    expect(screen.queryByText('Child Chat')).not.toBeInTheDocument();
  });

  it('shows child chats again after clicking the expand chevron twice', () => {
    render(<ChatTree chats={nestedChats} activeChatId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    const chevronButtons = screen.getAllByRole('button');
    const chevron = chevronButtons.find(btn =>
      btn.closest('div')?.textContent?.includes('Parent Chat')
    );
    fireEvent.click(chevron!); // collapse
    fireEvent.click(chevron!); // expand again
    expect(screen.getByText('Child Chat')).toBeInTheDocument();
  });
});

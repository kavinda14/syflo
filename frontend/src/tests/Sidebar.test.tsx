import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from '../components/Sidebar';
import type { Chat } from '../types';

const mockChats: Chat[] = [
  { id: '1', title: 'First Chat', parent_id: null, parent_word: null, created_at: new Date().toISOString(), children: [] },
  { id: '2', title: 'Second Chat', parent_id: null, parent_word: null, created_at: new Date().toISOString(), children: [
    { id: '3', title: 'Child Chat', parent_id: '2', parent_word: 'quantum', created_at: new Date().toISOString(), children: [] }
  ]},
];

describe('Sidebar', () => {
  const defaultProps = {
    chats: mockChats,
    activeChatId: null,
    onSelect: vi.fn(),
    onNewChat: vi.fn(),
    onDelete: vi.fn(),
    viewMode: 'chat' as const,
    onToggleView: vi.fn(),
  };

  it('renders root chat titles', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('First Chat')).toBeInTheDocument();
    expect(screen.getByText('Second Chat')).toBeInTheDocument();
  });

  it('does not show child chats in default flat view', () => {
    render(<Sidebar {...defaultProps} />);
    // Default view only shows root-level chats
    expect(screen.queryByText('Child Chat')).not.toBeInTheDocument();
  });

  it('shows child chat after clicking a root (parent_word badge removed)', () => {
    render(<Sidebar {...defaultProps} />);
    // Click on 'Second Chat' to expand its children
    fireEvent.click(screen.getByText('Second Chat'));
    expect(screen.getByText('Child Chat')).toBeInTheDocument();
    expect(screen.queryByText('quantum')).not.toBeInTheDocument();
  });

  it('shows back button in expanded view', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('Second Chat'));
    expect(screen.getByText('All chats')).toBeInTheDocument();
  });

  it('returns to flat view when back button is clicked', () => {
    render(<Sidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('Second Chat'));
    fireEvent.click(screen.getByText('All chats'));
    expect(screen.getByText('First Chat')).toBeInTheDocument();
    expect(screen.queryByText('Child Chat')).not.toBeInTheDocument();
  });

  it('calls onSelect when chat is clicked', () => {
    const onSelect = vi.fn();
    render(<Sidebar {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('First Chat'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('calls onNewChat when New Chat button clicked', () => {
    const onNewChat = vi.fn();
    render(<Sidebar {...defaultProps} onNewChat={onNewChat} />);
    fireEvent.click(screen.getByTitle('New Chat'));
    expect(onNewChat).toHaveBeenCalled();
  });

  it('shows empty state message when no chats', () => {
    render(<Sidebar {...defaultProps} chats={[]} />);
    expect(screen.getByText(/No chats yet/i)).toBeInTheDocument();
  });

  it('highlights active root chat', () => {
    render(<Sidebar {...defaultProps} activeChatId="1" />);
    const activeItem = screen.getByText('First Chat').closest('div');
    expect(activeItem?.className).toContain('bg-blue-50');
  });

  it('opens a confirmation dialog when the trash icon is clicked instead of deleting immediately', () => {
    const onDelete = vi.fn();
    render(<Sidebar {...defaultProps} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByTitle('Delete chat');
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByText('Delete chat?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('cancel in the confirmation dialog closes it without deleting', () => {
    const onDelete = vi.fn();
    render(<Sidebar {...defaultProps} onDelete={onDelete} />);
    fireEvent.click(screen.getAllByTitle('Delete chat')[0]);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete chat?')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('confirming the dialog calls onDelete with the right id', () => {
    const onDelete = vi.fn();
    render(<Sidebar {...defaultProps} onDelete={onDelete} />);
    fireEvent.click(screen.getAllByTitle('Delete chat')[0]);
    // The Delete inside the modal — distinguish from the title "Delete chat?"
    const deleteBtns = screen.getAllByText('Delete');
    fireEvent.click(deleteBtns[deleteBtns.length - 1]);
    expect(onDelete).toHaveBeenCalledWith('1');
  });
});

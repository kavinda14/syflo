import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatArea } from '../components/ChatArea';
import type { ChatDetail } from '../types';

const mockChat: ChatDetail = {
  id: '1',
  title: 'Test Chat',
  parent_id: null,
  parent_word: null,
  created_at: new Date().toISOString(),
  messages: [
    { id: 'm1', chat_id: '1', role: 'user', content: 'Hello there', created_at: new Date().toISOString() },
    { id: 'm2', chat_id: '1', role: 'assistant', content: 'Hi! How can I help?', created_at: new Date().toISOString() },
  ],
  children: [],
};

const defaultProps = {
  streaming: false,
  onSendMessage: vi.fn().mockResolvedValue(undefined),
  onWordRightClick: vi.fn(),
  onSelectChat: vi.fn(),
};

describe('ChatArea', () => {
  beforeEach(() => {
    defaultProps.onSendMessage.mockClear();
    defaultProps.onWordRightClick.mockClear();
  });

  it('shows welcome screen when no chat selected', () => {
    render(<ChatArea chat={null} loading={false} {...defaultProps} />);
    expect(screen.getByText(/How can I help you today/i)).toBeInTheDocument();
  });

  it('renders chat messages', () => {
    render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('Hi! How can I help?')).toBeInTheDocument();
  });

  it('displays chat title', () => {
    render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
  });

  it('sends message on Enter key', async () => {
    render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask anything/i);
    fireEvent.change(textarea, { target: { value: 'Hello!' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Hello!'));
  });

  it('does not send empty message', async () => {
    render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask anything/i);
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
  });

  it('shows parent_word when chat is a child', () => {
    const childChat = { ...mockChat, parent_word: 'quantum', parent_id: '0' };
    render(<ChatArea chat={childChat} loading={false} {...defaultProps} />);
    expect(screen.getByText(/quantum/i)).toBeInTheDocument();
  });

  it('uses the same spacing between all message bubbles', () => {
    const chatWithGroupedMessages: ChatDetail = {
      ...mockChat,
      messages: [
        { id: 'm1', chat_id: '1', role: 'user', content: 'First', created_at: new Date().toISOString() },
        { id: 'm2', chat_id: '1', role: 'user', content: 'Second', created_at: new Date().toISOString() },
        { id: 'm3', chat_id: '1', role: 'assistant', content: 'Third', created_at: new Date().toISOString() },
      ],
    };

    render(<ChatArea chat={chatWithGroupedMessages} loading={false} {...defaultProps} />);

    expect(screen.getByTestId('message-row-m1')).toHaveStyle({ marginTop: '0px' });
    expect(screen.getByTestId('message-row-m2')).toHaveStyle({ marginTop: '2rem' });
    expect(screen.getByTestId('message-row-m3')).toHaveStyle({ marginTop: '2rem' });
  });

  it('centers the content shell and input shell in the chat window', () => {
    render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);

    const headerShell = screen.getByTestId('chat-header-shell');
    const contentShell = screen.getByTestId('chat-content-shell');
    const inputShell = screen.getByTestId('chat-input-shell');
    const headerWrapper = headerShell.parentElement as HTMLElement;
    const contentWrapper = contentShell.parentElement as HTMLElement;
    const inputWrapper = inputShell.parentElement as HTMLElement;

    expect(headerWrapper.className).toContain('justify-center');
    expect(headerShell).toHaveStyle({ width: '46rem', maxWidth: 'calc(100% - 3rem)' });
    expect(contentWrapper.className).toContain('justify-center');
    expect(contentShell).toHaveStyle({ width: '46rem', maxWidth: 'calc(100% - 3rem)' });
    expect(inputWrapper.className).toContain('justify-center');
    expect(inputShell).toHaveStyle({ width: '46rem', maxWidth: 'calc(100% - 3rem)' });
  });
});

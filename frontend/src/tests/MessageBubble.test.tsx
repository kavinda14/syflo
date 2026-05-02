/**
 * MessageBubble.test.tsx
 *
 * Tests for the MessageBubble component which renders individual chat messages.
 * Covers user vs assistant styling, markdown rendering, the streaming cursor,
 * and the right-click word-lookup behaviour.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageBubble } from '../components/ChatArea/MessageBubble';
import type { Message } from '../types';

const userMessage: Message = {
  id: 'u1',
  chat_id: 'c1',
  role: 'user',
  content: 'Hello there',
  created_at: new Date().toISOString(),
};

const assistantMessage: Message = {
  id: 'a1',
  chat_id: 'c1',
  role: 'assistant',
  content: 'Hi! How can I help?',
  created_at: new Date().toISOString(),
};

const markdownMessage: Message = {
  id: 'a2',
  chat_id: 'c1',
  role: 'assistant',
  content: '**Bold text** and `inline code`',
  created_at: new Date().toISOString(),
};

describe('MessageBubble – user messages', () => {
  it('renders the message text', () => {
    render(<MessageBubble message={userMessage} onWordRightClick={vi.fn()} />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('aligns user messages to the right', () => {
    const { container } = render(
      <MessageBubble message={userMessage} onWordRightClick={vi.fn()} />
    );
    // The outer wrapper should have justify-end for right alignment
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
  });

  it('does not show the assistant avatar for user messages', () => {
    render(<MessageBubble message={userMessage} onWordRightClick={vi.fn()} />);
    // The "F" avatar is only rendered for assistant messages
    expect(screen.queryByText('F')).not.toBeInTheDocument();
  });
});

describe('MessageBubble – assistant messages', () => {
  it('renders the message text', () => {
    render(<MessageBubble message={assistantMessage} onWordRightClick={vi.fn()} />);
    expect(screen.getByText('Hi! How can I help?')).toBeInTheDocument();
  });

  it('does not show an avatar for assistant messages', () => {
    render(<MessageBubble message={assistantMessage} onWordRightClick={vi.fn()} />);
    expect(screen.queryByText('F')).not.toBeInTheDocument();
  });

  it('renders bold markdown text', () => {
    render(<MessageBubble message={markdownMessage} onWordRightClick={vi.fn()} />);
    // react-markdown wraps **bold** in a <strong> element
    const bold = screen.getByText('Bold text');
    expect(bold.tagName).toBe('STRONG');
  });

  it('renders inline code markdown', () => {
    render(<MessageBubble message={markdownMessage} onWordRightClick={vi.fn()} />);
    // react-markdown wraps `code` in a <code> element
    const code = screen.getByText('inline code');
    expect(code.tagName).toBe('CODE');
  });
});

describe('MessageBubble – streaming cursor', () => {
  it('does not show the cursor when isStreaming is false', () => {
    const { container } = render(
      <MessageBubble message={assistantMessage} isStreaming={false} onWordRightClick={vi.fn()} />
    );
    // The cursor is an animate-pulse span — it should not exist when not streaming
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('shows the animated cursor when isStreaming is true', () => {
    const { container } = render(
      <MessageBubble message={assistantMessage} isStreaming={true} onWordRightClick={vi.fn()} />
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows the cursor even when content is empty (start of stream)', () => {
    const emptyMsg: Message = { ...assistantMessage, content: '' };
    const { container } = render(
      <MessageBubble message={emptyMsg} isStreaming={true} onWordRightClick={vi.fn()} />
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});

describe('MessageBubble – right-click word lookup', () => {
  it('fires onWordRightClick when right-clicking an assistant message', () => {
    // jsdom does not implement text selection, so mock getSelection to return a word
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'help',
    } as unknown as Selection);

    const onWordRightClick = vi.fn();
    render(
      <MessageBubble message={assistantMessage} onWordRightClick={onWordRightClick} />
    );
    const msgEl = screen.getByText('Hi! How can I help?');
    fireEvent.contextMenu(msgEl, { clientX: 50, clientY: 50 });
    // Verify the callback was called with the selected word and message content.
    // clientX/clientY are 0 in jsdom regardless of what is passed to fireEvent.
    expect(onWordRightClick).toHaveBeenCalledWith(
      'help',
      assistantMessage.content,
      expect.any(Number),
      expect.any(Number)
    );

    vi.restoreAllMocks();
  });

  it('does NOT fire onWordRightClick when right-clicking a user message', () => {
    const onWordRightClick = vi.fn();
    render(
      <MessageBubble message={userMessage} onWordRightClick={onWordRightClick} />
    );
    const msgEl = screen.getByText('Hello there');
    fireEvent.contextMenu(msgEl);
    // User messages are not interactive for word lookup
    expect(onWordRightClick).not.toHaveBeenCalled();
  });
});

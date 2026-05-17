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
    await waitFor(() => expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Hello!', []));
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

  describe('Anhang-Plus-Menü', () => {
    it('öffnet beim Klick auf Plus ein Menü, nicht direkt den File-Picker', () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      expect(screen.queryByTestId('attach-menu')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('attach-plus-button'));
      expect(screen.getByTestId('attach-menu')).toBeInTheDocument();
      expect(screen.getByTestId('attach-menu-files')).toHaveTextContent(/Files and media/i);
    });

    it('schließt das Menü, wenn man "Files and media" auswählt', () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      fireEvent.click(screen.getByTestId('attach-plus-button'));
      fireEvent.click(screen.getByTestId('attach-menu-files'));
      expect(screen.queryByTestId('attach-menu')).not.toBeInTheDocument();
    });

    it('schließt das Menü beim Klick außerhalb', () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      fireEvent.click(screen.getByTestId('attach-plus-button'));
      expect(screen.getByTestId('attach-menu')).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('attach-menu')).not.toBeInTheDocument();
    });
  });

  describe('Anhang-Alias umbenennen und @-Autocomplete', () => {
    // Hilfsfunktion: simuliert eine vom User ausgewählte Datei.
    const attachFile = (name: string, type: string) => {
      const file = new File(['hello'], name, { type });
      const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
      fireEvent.change(hiddenInput);
    };

    it('benennt einen Alias um und aktualisiert auch den Eingabefeld-Text', async () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      attachFile('cat.png', 'image/png');
      // Anfang: @foto1
      const aliasButton = await screen.findByTestId('attachment-alias');
      expect(aliasButton).toHaveTextContent('@foto1');

      // Erst @foto1 ins Eingabefeld einfügen — dann umbenennen.
      const textarea = screen.getByPlaceholderText(/Ask anything/i);
      fireEvent.change(textarea, { target: { value: '@foto1 was ist das?' } });

      fireEvent.click(aliasButton);
      const input = screen.getByTestId('attachment-alias-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '@katze' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Chip zeigt neuen Namen
      expect(await screen.findByTestId('attachment-alias')).toHaveTextContent('@katze');
      // Eingabefeld wurde mitgezogen
      expect((textarea as HTMLTextAreaElement).value).toBe('@katze was ist das?');
    });

    it('hängt automatisch _2 an, wenn der gewünschte Alias schon existiert', async () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      // Zwei Bilder hochladen → @foto1, @foto2
      attachFile('a.png', 'image/png');
      attachFile('b.png', 'image/png');
      const aliases = await screen.findAllByTestId('attachment-alias');
      expect(aliases.map(a => a.textContent)).toEqual(['@foto1', '@foto2']);

      // @foto2 → @foto1 umbenennen (Konflikt!) → erwartet @foto1_2
      fireEvent.click(aliases[1]);
      const input = screen.getByTestId('attachment-alias-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '@foto1' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const after = await screen.findAllByTestId('attachment-alias');
      expect(after.map(a => a.textContent)).toEqual(['@foto1', '@foto1_2']);
    });

    it('stellt @ vor jedem Alias sicher, auch wenn der User es weglässt', async () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      attachFile('a.png', 'image/png');
      const aliasButton = await screen.findByTestId('attachment-alias');

      fireEvent.click(aliasButton);
      const input = screen.getByTestId('attachment-alias-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'kuh' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(await screen.findByTestId('attachment-alias')).toHaveTextContent('@kuh');
    });

    it('Pfeiltasten + Enter wählen einen Vorschlag, statt die Nachricht zu senden', async () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      attachFile('a.png', 'image/png');
      attachFile('b.png', 'image/png');

      const textarea = screen.getByPlaceholderText(/Ask anything/i) as HTMLTextAreaElement;
      // "@" tippen → Dropdown öffnet sich mit @foto1 / @foto2
      fireEvent.change(textarea, { target: { value: '@' } });
      expect(await screen.findByTestId('mention-item-@foto1')).toBeInTheDocument();

      // Pfeil ↓ → @foto2 wird hervorgehoben
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      // Enter → wählt @foto2 in den Text und sendet NICHT
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
      expect(textarea.value).toBe('@foto2 ');
    });

    it('Escape schließt das Mention-Dropdown', async () => {
      render(<ChatArea chat={mockChat} loading={false} {...defaultProps} />);
      attachFile('a.png', 'image/png');

      const textarea = screen.getByPlaceholderText(/Ask anything/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: '@' } });
      expect(await screen.findByTestId('mention-item-@foto1')).toBeInTheDocument();

      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByTestId('mention-item-@foto1')).not.toBeInTheDocument();
    });
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FloatingPopup } from '../components/FloatingPopup';
import type { WordPopup } from '../types';

const mockPopup: WordPopup = {
  word: 'quantum',
  context: 'Quantum physics is complex',
  x: 100,
  y: 100,
};

describe('FloatingPopup', () => {
  const defaultProps = {
    popup: mockPopup,
    explanation: 'Quantum refers to the smallest discrete unit of a phenomenon.',
    loading: false,
    onClose: vi.fn(),
    onOpenChildChat: vi.fn(),
  };

  it('renders nothing when popup is null', () => {
    const { container } = render(<FloatingPopup {...defaultProps} popup={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the word in the header', () => {
    render(<FloatingPopup {...defaultProps} />);
    expect(screen.getByText(/"quantum"/i)).toBeInTheDocument();
  });

  it('shows explanation text', () => {
    render(<FloatingPopup {...defaultProps} />);
    expect(screen.getByText(/Quantum refers to/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<FloatingPopup {...defaultProps} loading={true} explanation="" />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn();
    render(<FloatingPopup {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onOpenChildChat when branch button clicked', () => {
    const onOpenChildChat = vi.fn();
    render(<FloatingPopup {...defaultProps} onOpenChildChat={onOpenChildChat} />);
    fireEvent.click(screen.getByText(/Open as new chat/i));
    expect(onOpenChildChat).toHaveBeenCalledWith('quantum', 'Quantum physics is complex');
  });

  describe('copy button', () => {
    it('writes the popup word to the clipboard when clicked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<FloatingPopup {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /copy text/i }));

      expect(writeText).toHaveBeenCalledWith('quantum');
    });

    it('switches the icon label to "Copied" after a successful copy', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<FloatingPopup {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /copy text/i }));

      // Wait for the async clipboard write + state update to flush.
      await screen.findByRole('button', { name: /copied/i });
    });
  });
});

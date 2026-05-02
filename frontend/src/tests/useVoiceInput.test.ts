/**
 * useVoiceInput.test.ts
 *
 * Tests for the global spacebar shortcut in useVoiceInput.
 * The key behaviour: spacebar starts voice input UNLESS the user is
 * actively typing (a text field is focused AND already has content).
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useVoiceInput } from '../hooks/useVoiceInput';

let mockRecognition: {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  onresult: any;
  onend: any;
};

beforeEach(() => {
  // Use a class so `new SpeechRecognitionAPI()` works correctly
  class MockSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = '';
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    onresult: any = null;
    onend: any = null;
    constructor() {
      // Capture the instance so tests can assert on it
      mockRecognition = this as any;
    }
  }
  (window as any).SpeechRecognition = MockSpeechRecognition;
  (window as any).webkitSpeechRecognition = undefined;
});

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  vi.restoreAllMocks();
});

function pressSpace(repeat = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, repeat }));
}

function releaseSpace() {
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
}

describe('useVoiceInput – spacebar shortcut', () => {
  it('starts listening when spacebar is pressed with no focused element', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { pressSpace(); });

    expect(result.current.isListening).toBe(true);
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);
  });

  it('stops listening when spacebar is released', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { pressSpace(); });
    act(() => { releaseSpace(); });

    expect(result.current.isListening).toBe(false);
    expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
  });

  it('starts listening when textarea is focused but EMPTY', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    const textarea = document.createElement('textarea');
    textarea.value = '';
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => { pressSpace(); });

    expect(result.current.isListening).toBe(true);

    document.body.removeChild(textarea);
  });

  it('does NOT start listening when textarea is focused and has text', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    const textarea = document.createElement('textarea');
    textarea.value = 'some text already typed';
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => { pressSpace(); });

    expect(result.current.isListening).toBe(false);
    expect(mockRecognition.start).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('does NOT start listening on a key-repeat event (held key)', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { pressSpace(true); }); // repeat = true

    expect(result.current.isListening).toBe(false);
    expect(mockRecognition.start).not.toHaveBeenCalled();
  });

  it('does not start when enabled is false', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript, enabled: false }));

    act(() => { pressSpace(); });

    expect(result.current.isListening).toBe(false);
    expect(mockRecognition.start).not.toHaveBeenCalled();
  });
});

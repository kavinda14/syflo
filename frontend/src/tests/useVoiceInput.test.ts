/**
 * useVoiceInput.test.ts
 *
 * Tests for useVoiceInput:
 * - Spacebar PTT only fires when NO text input is focused (Option A).
 * - Transcript is buffered during recording and emitted only on stop.
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

// startListening setzt Audio-Analyser zuerst auf (async), und ruft erst danach
// recognition.start() auf. In Tests muss man eine Microtask-Tick abwarten,
// damit dieser Schritt ausgeführt wird.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useVoiceInput – spacebar shortcut', () => {
  it('starts listening when spacebar is pressed with no focused element', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { pressSpace(); });
    await act(async () => { await flush(); });

    expect(result.current.isListening).toBe(true);
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);
  });

  it('stops listening when spacebar is released', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { pressSpace(); });
    await act(async () => { await flush(); });
    act(() => { releaseSpace(); });

    expect(result.current.isListening).toBe(false);
    expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
  });

  it('does NOT start listening when an empty textarea is focused', () => {
    // Option A: Spacebar-PTT greift nur, wenn KEIN Text-Eingabefeld fokussiert ist —
    // egal ob es leer oder voll ist. Sonst würde die Leertaste mitten im Tippen
    // die Aufnahme starten.
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    const textarea = document.createElement('textarea');
    textarea.value = '';
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => { pressSpace(); });

    expect(result.current.isListening).toBe(false);
    expect(mockRecognition.start).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('does NOT start listening when textarea with content is focused', () => {
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

describe('useVoiceInput – Transkript wird gepuffert und erst nach onend übergeben', () => {
  // Hilfsfunktionen, um ein finalisiertes / vorläufiges Result-Event zu bauen.
  const finalResult = (text: string) => ({
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: text }], { isFinal: true }),
    ],
  });
  const interimResult = (text: string) => ({
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: text }], { isFinal: false }),
    ],
  });

  it('emittiert während der Aufnahme NICHTS, sondern erst wenn der Browser onend feuert', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { result.current.startListening(); });

    act(() => { mockRecognition.onresult(finalResult('hallo')); });
    act(() => { mockRecognition.onresult(finalResult('welt')); });
    expect(onTranscript).not.toHaveBeenCalled();

    // stop() allein liefert noch nichts — Browser kann noch finale Stücke
    // hinterherschicken.
    act(() => { result.current.stopListening(); });
    expect(onTranscript).not.toHaveBeenCalled();

    // Erst onend → kombinierter Text kommt einmalig durch.
    act(() => { mockRecognition.onend(); });
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('hallo welt');
  });

  it('rettet auch das letzte interim-Stück, wenn der Browser nichts finalisiert hat', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { result.current.startListening(); });
    // Nur interim, keine finalen Resultate
    act(() => { mockRecognition.onresult(interimResult('kurze frage')); });
    act(() => { result.current.stopListening(); });
    act(() => { mockRecognition.onend(); });

    expect(onTranscript).toHaveBeenCalledWith('kurze frage');
  });

  it('ruft onTranscript NICHT auf, wenn nichts gesprochen wurde', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { result.current.startListening(); });
    act(() => { result.current.stopListening(); });
    act(() => { mockRecognition.onend(); });

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('Toggle: zweites startListening nach stopListening startet eine neue Aufnahme', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { result.current.startListening(); });
    act(() => { mockRecognition.onresult(finalResult('eins')); });
    act(() => { result.current.stopListening(); });
    act(() => { mockRecognition.onend(); });
    expect(onTranscript).toHaveBeenLastCalledWith('eins');

    act(() => { result.current.startListening(); });
    act(() => { mockRecognition.onresult(finalResult('zwei')); });
    act(() => { result.current.stopListening(); });
    act(() => { mockRecognition.onend(); });
    expect(onTranscript).toHaveBeenLastCalledWith('zwei');
    expect(onTranscript).toHaveBeenCalledTimes(2);
  });

  it('startet automatisch neu, wenn der Browser bei Stille onend feuert während wir noch hören', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => { result.current.startListening(); });
    await act(async () => { await flush(); });
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);

    // Browser auto-stoppt bei Stille
    act(() => { mockRecognition.onend(); });
    expect(mockRecognition.start).toHaveBeenCalledTimes(2);
    expect(result.current.isListening).toBe(true);
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

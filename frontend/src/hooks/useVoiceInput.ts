/**
 * hooks/useVoiceInput.ts
 *
 * Custom React hook that wraps the browser's built-in Web Speech API to provide
 * voice dictation. No external packages are needed — Chrome and Safari support
 * SpeechRecognition natively.
 *
 * Features:
 * - startListening / stopListening functions to control recording
 * - liveText: the interim transcript shown as a preview while speaking
 * - onTranscript callback: called with the final recognised text to append it
 *   to the chat input
 * - Global spacebar shortcut: holding Spacebar anywhere on the page (except
 *   inside a text field) starts voice input, releasing it stops recording
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  enabled?: boolean;
}

export function useVoiceInput({ onTranscript, enabled = true }: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState('');

  // supported is false if the browser does not implement SpeechRecognition
  // (e.g. Firefox without the flag). The UI uses this to hide the mic button.
  const [supported, setSupported] = useState(false);

  // Store the recognition instance in a ref so it persists across re-renders
  // without triggering them.
  const recognitionRef = useRef<any>(null);

  // A plain ref (not state) to track whether we are currently listening.
  // This is read inside event callbacks where stale state would cause issues.
  const listeningRef = useRef(false);

  // Initialise the SpeechRecognition instance once when the component mounts.
  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    setSupported(true);
    const recognition: any = new SpeechRecognitionAPI();

    // continuous: keep listening until explicitly stopped (don't auto-stop after silence)
    recognition.continuous = true;

    // interimResults: fire events with partial text while the user is still speaking
    recognition.interimResults = true;

    // Use the browser's locale so German speakers get German recognition by default
    recognition.lang = navigator.language || 'de-DE';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      // Separate interim (still-being-spoken) results from finalised ones
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      // Show the live preview text below the input field
      setLiveText(interim || final);

      // Append confirmed words to the input field via the callback
      if (final) onTranscript(final);
    };

    // The recognition engine auto-stops after silence; restart it if we are
    // still in listening mode so recording stays active until the user releases
    // the spacebar or mic button.
    recognition.onend = () => {
      if (listeningRef.current) {
        try { recognition.start(); } catch (_) {}
      }
    };

    recognitionRef.current = recognition;

    // Abort recognition when the component unmounts to free browser resources.
    return () => {
      recognition.abort();
    };
  }, []);

  // Start listening: update both the ref (for callbacks) and state (for the UI).
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    listeningRef.current = true;
    setIsListening(true);
    setLiveText('');
    try { recognitionRef.current.start(); } catch (_) {}
  }, []);

  // Stop listening: clear the ref first so the onend handler does not restart.
  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    listeningRef.current = false;
    setIsListening(false);
    setLiveText('');
    try { recognitionRef.current.stop(); } catch (_) {}
  }, []);

  // Global spacebar shortcut — only activates when the user is NOT typing in a
  // text field, so normal typing is never interrupted.
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key-repeat events (held key firing repeatedly)
      if (e.code !== 'Space' || e.repeat) return;

      const active = document.activeElement;
      const isTextInput =
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement;

      // Allow spacebar to trigger voice when the text field is empty —
      // the user cannot be "typing" if there is nothing typed yet.
      const hasText = isTextInput &&
        (active as HTMLTextAreaElement | HTMLInputElement).value.length > 0;

      if (!isTextInput || !hasText) {
        e.preventDefault(); // prevent page scroll or typing a space
        startListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      // Only stop if we started via the spacebar (listeningRef is our source of truth)
      if (listeningRef.current) stopListening();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, startListening, stopListening]);

  return { isListening, liveText, supported, startListening, stopListening };
}

/**
 * hooks/useVoiceInput.ts
 *
 * Wrapper um die Web Speech API (Spracherkennung) mit ChatGPT-ähnlichem
 * Klick-Toggle-Verhalten:
 *   - startListening() startet, stopListening() stoppt
 *   - während der Aufnahme wird das Transkript intern gepuffert; erst beim
 *     Stoppen wird es als ein Block per onTranscript an das Eingabefeld
 *     übergeben (kein "live tippen" mehr)
 *   - parallel zur Spracherkennung läuft ein AnalyserNode auf dem Mikrofon-
 *     Stream, damit `volume` (0..1) für eine echte Lautstärken-Wellen-
 *     Visualisierung verwendet werden kann
 *   - Spacebar als Push-to-Talk: greift NUR, wenn aktuell KEIN Text-
 *     Eingabefeld fokussiert ist — sonst tippt die Leertaste normal
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  enabled?: boolean;
}

export function useVoiceInput({ onTranscript, enabled = true }: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  // Aktuelle Mikrofon-Lautstärke 0..1, wird ~60×/s aktualisiert.
  const [volume, setVolume] = useState(0);
  const [supported, setSupported] = useState(false);

  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);

  // Sammelt alle bereits "finalisierten" Stücke — wachsen monoton während der
  // Aufnahme.
  const finalsRef = useRef('');
  // Speichert das aktuell unfertige (interim) Stück — wird bei jedem onresult
  // überschrieben. Wenn der User stoppt, bevor der Browser das Stück
  // finalisieren konnte, retten wir es trotzdem.
  const interimRef = useRef('');

  // Aktuelle onTranscript-Callback-Referenz, damit stopListening die neueste
  // Version des Callbacks aufruft, ohne dass startListening/stopListening
  // ständig neue Identitäten bekommen.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // Web-Audio-Ressourcen für Lautstärken-Erkennung.
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Ref auf teardownAudio, damit der recognition.onerror-Handler — der einmalig
  // im useEffect unten registriert wird — auch nach späteren Renderings die
  // aktuelle Funktion erreicht.
  const teardownAudioRef = useRef<() => void>(() => {});

  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    setSupported(true);
    const recognition: any = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'de-DE';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (final) {
        const trimmed = final.trim();
        finalsRef.current = finalsRef.current
          ? finalsRef.current + ' ' + trimmed
          : trimmed;
      }
      // Aktuelles interim-Stück merken (überschreibt das vorherige).
      interimRef.current = interim.trim();
    };

    // onend feuert, wenn der Browser die Aufnahme beendet — entweder weil
    // continuous-Modus bei Stille auto-stoppt (dann neu starten), oder weil
    // der User stop() aufgerufen hat (dann das gesammelte Transkript an das
    // Eingabefeld übergeben).
    recognition.onend = () => {
      if (listeningRef.current) {
        try { recognition.start(); } catch (e) { console.error('[useVoiceInput] restart failed', e); }
        return;
      }
      const combined = [finalsRef.current, interimRef.current]
        .filter(Boolean)
        .join(' ')
        .trim();
      finalsRef.current = '';
      interimRef.current = '';
      if (combined) onTranscriptRef.current(combined);
    };

    recognition.onerror = (event: any) => {
      console.error('[useVoiceInput] error:', event?.error, event);
      // Endgültige Fehler → State zurücksetzen, damit der User aus dem
      // "rotes Mic"-Zustand rauskommt.
      const fatal = ['not-allowed', 'service-not-allowed', 'audio-capture'];
      if (fatal.includes(event?.error)) {
        listeningRef.current = false;
        setIsListening(false);
        teardownAudioRef.current?.();
      }
    };

    recognitionRef.current = recognition;
    return () => {
      try { recognition.abort(); } catch (_) {}
    };
  }, []);

  const teardownAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setVolume(0);
  }, []);
  teardownAudioRef.current = teardownAudio;

  const setupAudioAnalyser = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    // AudioContext muss bereits SYNCHRON im Klick-Handler erstellt worden
    // sein (siehe startListening), damit er nicht im suspended-Zustand
    // hängt. Hier nur noch verwenden.
    const ctx = audioContextRef.current;
    if (!ctx) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!listeningRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;

      // Falls der Browser den Context trotz User-Gesture suspended startet,
      // hier nochmal versuchen.
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch (e) {
          console.error('[useVoiceInput] AudioContext.resume failed', e);
        }
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // Höher = mehr Glättung der Frequenzdaten direkt in der Web Audio API.
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const speechBins = Math.max(8, Math.floor(dataArray.length * 0.25));
      // Exponentielles Glätten: aktueller Wert mischt sich mit dem letzten.
      // Höheres alpha → folgt der Stimme schneller, niedriger → träger und
      // ruhiger. 0.25 ist ein guter Kompromiss aus Reaktivität und Ruhe.
      let smoothed = 0;
      const alpha = 0.25;
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < speechBins; i++) sum += dataArray[i];
        const avg = sum / speechBins / 255;
        const target = Math.min(1, avg * 5);
        smoothed = smoothed * (1 - alpha) + target * alpha;
        setVolume(smoothed);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      // Häufige Ursache: getUserMedia verweigert oder Browser blockiert
      // parallelen Mikro-Zugriff (SpeechRecognition belegt Mikro bereits).
      // Wir loggen, damit der User die Ursache in der Konsole sieht.
      console.error('[useVoiceInput] audio analyser setup failed', e);
    }
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (listeningRef.current) return;
    listeningRef.current = true;
    setIsListening(true);
    finalsRef.current = '';
    interimRef.current = '';

    // KRITISCH: AudioContext synchron im User-Gesture-Stack erstellen.
    // Wenn man wartet, bis `getUserMedia` async aufgelöst ist, gilt der
    // Klick nicht mehr als User-Gesture und der Context startet "suspended".
    // Dann liefert der AnalyserNode durchgehend Stille, egal wie laut man
    // spricht.
    const AudioCtx: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx && !audioContextRef.current) {
      try {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        // resume() hier ebenfalls SYNCHRON anstoßen — wir warten nicht auf
        // das Promise, der Aufruf reicht, um den running-Zustand zu erzwingen.
        if (ctx.state === 'suspended') {
          ctx.resume().catch(e => console.error('[useVoiceInput] resume failed', e));
        }
      } catch (e) {
        console.error('[useVoiceInput] AudioContext create failed', e);
      }
    }

    setupAudioAnalyser().finally(() => {
      if (!listeningRef.current) return;
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error('[useVoiceInput] start failed', e);
      }
    });
  }, [setupAudioAnalyser]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (!listeningRef.current) return;
    listeningRef.current = false;
    setIsListening(false);
    try {
      recognitionRef.current.stop();
    } catch (e) {
      console.error('[useVoiceInput] stop failed', e);
    }
    teardownAudio();
    // Das gesammelte Transkript wird im onend-Handler an onTranscript
    // übergeben — vorher können noch finale Stücke vom Browser nachkommen.
  }, [teardownAudio]);

  // Spacebar-Shortcut: nur, wenn KEIN Text-Eingabefeld fokussiert ist —
  // sonst würde Leertaste mitten im Tippen die Aufnahme starten und
  // verhindern, dass Leerzeichen im Text landen.
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const active = document.activeElement;
      const isTextInput =
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isTextInput) return;
      e.preventDefault();
      startListening();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (listeningRef.current) stopListening();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, startListening, stopListening]);

  return { isListening, volume, supported, startListening, stopListening };
}

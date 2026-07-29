import { useEffect, useRef, useState, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { chatMachine } from './machines/chatMachine';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null)
    : null;

const STT_SUPPORTED = SpeechRecognitionAPI !== null;

const LANG_CODES: Record<'en' | 'es', string> = { en: 'en-US', es: 'es-ES' };

export default function ChatboardApp() {
  const [snapshot, send] = useMachine(chatMachine);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null);

  // Interim text shown in the live user bubble while recognition is running
  const [interimText, setInterimText] = useState('');
  // Text input fallback (when STT is not supported)
  const [fallbackText, setFallbackText] = useState('');
  // Mic permission / recognition error message
  const [micError, setMicError] = useState<string | null>(null);

  // Emit chat-closed on window unload (keep existing logic)
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let cleanup: (() => void) | null = null;

    import('@tauri-apps/api/event').then(({ emit }) => {
      const handle = () => { emit('chat-closed'); };
      window.addEventListener('beforeunload', handle);
      cleanup = () => window.removeEventListener('beforeunload', handle);
    });

    return () => { cleanup?.(); };
  }, []);

  // Fire TTS whenever machine enters the 'speaking' state
  useEffect(() => {
    if (snapshot.value !== 'speaking') return;

    const text = snapshot.context.currentUtterance;
    const language = snapshot.context.language;
    if (!text || !language) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = LANG_CODES[language];
    utter.onend = () => send({ type: 'SPEECH_END' });
    speechSynthesis.speak(utter);

    return () => {
      speechSynthesis.cancel();
    };
  }, [snapshot.value, snapshot.context.currentUtterance, send]);

  // Auto-scroll transcript to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot.context.messages]);

  // Also scroll when interim text appears
  useEffect(() => {
    if (interimText) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [interimText]);

  // Start Web Speech API recognition
  const startRecognition = useCallback(() => {
    if (!STT_SUPPORTED || !SpeechRecognitionAPI) return;

    const language = snapshot.context.language;
    const lang = language ? LANG_CODES[language] : 'en-US';

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      const text = last[0].transcript;
      if (last.isFinal) {
        setInterimText('');
        send({ type: 'SPEECH_RESULT', text });
      } else {
        setInterimText(text);
      }
    };

    recognition.onend = () => {
      setInterimText('');
      recognitionRef.current = null;
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setMicError('麥克風權限被拒絕，請在瀏覽器設定中允許麥克風存取。');
      }
      setInterimText('');
      recognitionRef.current = null;
    };

    setMicError(null);
    recognition.start();
  }, [snapshot.context.language, send]);

  // Abort recognition if machine leaves 'listening' unexpectedly
  useEffect(() => {
    if (snapshot.value !== 'listening' && recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setInterimText('');
    }
  }, [snapshot.value]);

  const isIdle = snapshot.value === 'idle';
  const isListening = snapshot.value === 'listening';
  const isSpeaking = snapshot.value === 'speaking';
  const isProcessing = snapshot.value === 'processing';

  const micDisabled = isSpeaking || isProcessing || isListening;

  const handleMicClick = () => {
    send({ type: 'TAP_MIC' });
    startRecognition();
  };

  const handleFallbackSubmit = () => {
    if (!fallbackText.trim()) return;
    const text = fallbackText.trim();
    setFallbackText('');
    send({ type: 'TAP_MIC' });
    // Give the machine a tick to enter listening, then send the result
    setTimeout(() => {
      send({ type: 'SPEECH_RESULT', text });
    }, 0);
  };

  return (
    <main className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-border shrink-0">
        <span className="text-lg font-semibold">🐸 Kero 對話練習</span>
      </header>

      {/* Body */}
      {snapshot.value === 'selectingLanguage' ? (
        /* Language selection */
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <p className="text-base text-muted-foreground">請選擇對話語言</p>
          <div className="flex gap-4">
            <Button
              size="lg"
              onClick={() => send({ type: 'SELECT_LANGUAGE', lang: 'en' })}
            >
              English
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => send({ type: 'SELECT_LANGUAGE', lang: 'es' })}
            >
              Español
            </Button>
          </div>
        </div>
      ) : (
        /* Conversation view */
        <>
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="flex flex-col gap-3">
              {snapshot.context.messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'kero' ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                      msg.role === 'kero'
                        ? 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-100'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {/* Live interim user bubble */}
              {interimText ? (
                <div className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed bg-secondary/50 text-secondary-foreground/60 italic">
                    {interimText}
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Control bar */}
          <div className="flex flex-col items-center border-t border-border shrink-0">
          {micError ? (
            <p className="text-xs text-red-500 px-4 pt-2">{micError}</p>
          ) : null}
          <div className="flex items-center justify-center px-4 py-3 gap-3 w-full">
            {STT_SUPPORTED ? (
              <Button
                size="icon-lg"
                variant="outline"
                disabled={micDisabled}
                aria-label="按下說話"
                aria-pressed={isListening}
                onClick={handleMicClick}
                className={isListening ? 'ring-2 ring-red-500 ring-offset-2 text-red-500' : ''}
              >
                🎤
              </Button>
            ) : (
              /* Fallback text input when Web Speech API is not supported */
              <>
                <input
                  type="text"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="輸入訊息…"
                  value={fallbackText}
                  disabled={!isIdle}
                  onChange={(e) => setFallbackText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFallbackSubmit();
                  }}
                />
                <Button
                  size="sm"
                  disabled={!isIdle || !fallbackText.trim()}
                  onClick={handleFallbackSubmit}
                >
                  送出
                </Button>
              </>
            )}
          </div>
          </div>
        </>
      )}
    </main>
  );
}

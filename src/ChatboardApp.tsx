import { useEffect, useRef } from 'react';
import { useMachine } from '@xstate/react';
import { chatMachine } from './machines/chatMachine';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export default function ChatboardApp() {
  const [snapshot, send] = useMachine(chatMachine);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    utter.lang = language === 'en' ? 'en-US' : 'es-ES';
    utter.onend = () => send({ type: 'SPEECH_END' });
    speechSynthesis.speak(utter);

    return () => {
      speechSynthesis.cancel();
    };
  }, [snapshot.value, snapshot.context.currentUtterance]);

  // Auto-scroll transcript to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot.context.messages]);

  const isSpeaking = snapshot.value === 'speaking';
  const isProcessing = snapshot.value === 'processing';
  const micDisabled = isSpeaking || isProcessing || snapshot.value === 'idle';

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
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Control bar */}
          <div className="flex items-center justify-center px-4 py-3 border-t border-border shrink-0">
            <Button
              size="icon-lg"
              variant="outline"
              disabled={micDisabled}
              aria-label="按下說話"
              onClick={() => send({ type: 'TAP_MIC' })}
            >
              🎤
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

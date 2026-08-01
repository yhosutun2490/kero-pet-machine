import { useEffect, useRef } from 'react';
import type { SnapshotFrom } from 'xstate';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { chatMachine, ChatEvent } from '@/machines/chatMachine';

type ChatSnapshot = SnapshotFrom<typeof chatMachine>;

export interface ChatPageProps {
  snapshot: ChatSnapshot;
  send: (event: ChatEvent) => void;
  pttDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  pttUp: () => void;
  keroInterim: string;
}

/**
 * The Practice View — a presentational surface for the conversation. It owns no
 * connection or lifecycle state (that lives in the Shell); it only renders the
 * machine snapshot and dispatches events. Its one local concern is scrolling
 * the transcript to the bottom on new content.
 */
export default function ChatPage({ snapshot, send, pttDown, pttUp, keroInterim }: ChatPageProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages / interim text.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot.context.messages, keroInterim]);

  const speaker = snapshot.context.speaker;
  const keroSpeaking = speaker === 'kero';

  return (
    <main className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center px-4 py-3 border-b border-border shrink-0">
        <span className="text-lg font-semibold">🐸 Kero 對話練習</span>
      </header>

      {snapshot.value === 'selectingLanguage' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <p className="text-base text-muted-foreground">請選擇對話語言</p>
          <div className="flex gap-4">
            <Button size="lg" onClick={() => send({ type: 'SELECT_LANGUAGE', lang: 'en' })}>
              English
            </Button>
            <Button size="lg" variant="outline" onClick={() => send({ type: 'SELECT_LANGUAGE', lang: 'es' })}>
              Español
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="flex flex-col gap-3">
              {snapshot.context.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'kero' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    msg.role === 'kero'
                      ? 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-100'
                      : 'bg-secondary text-secondary-foreground'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {keroInterim ? (
                <div className="flex justify-start">
                  <div className="max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed bg-green-100/60 text-green-900/70 italic dark:bg-green-900/20">
                    {keroInterim}
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="flex flex-col items-center border-t border-border shrink-0">
            {snapshot.value === 'error' ? (
              <p className="text-xs text-red-500 px-4 pt-2">{snapshot.context.error}</p>
            ) : null}

            <div className="flex items-center justify-center px-4 py-3 gap-3 w-full">
              {snapshot.value === 'connecting' ? (
                <span className="text-sm text-muted-foreground">連線中…</span>
              ) : snapshot.value === 'live' ? (
                <>
                  <Button
                    size="icon-lg"
                    variant="outline"
                    disabled={keroSpeaking}
                    aria-label="按住說話"
                    aria-pressed={speaker === 'user'}
                    onPointerDown={pttDown}
                    onPointerUp={pttUp}
                    onPointerCancel={pttUp}
                    className={speaker === 'user' ? 'ring-2 ring-red-500 ring-offset-2 text-red-500' : ''}
                  >
                    🎤
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: 'END' })}>
                    結束
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => send({ type: 'RESTART' })}>
                  重新開始
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

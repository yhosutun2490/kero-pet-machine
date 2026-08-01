import { useEffect, useRef, useState, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { chatMachine } from './machines/chatMachine';
import {
  getRealtimeSession,
  connectRealtime,
  type RealtimeConnection,
} from './lib/realtime';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const MIC_DENIED_MSG =
  '無法存取麥克風。請前往「系統設定 → 隱私權與安全性 → 麥克風」，允許 Kero 使用麥克風。';

export default function ChatboardApp() {
  const [snapshot, send] = useMachine(chatMachine);
  const bottomRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);

  // Streaming interim transcript for Kero's current turn.
  const [keroInterim, setKeroInterim] = useState('');

  // Emit chat-closed on window unload (keep existing Tauri behaviour).
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

  // Auto-scroll on new messages / interim text.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot.context.messages, keroInterim]);

  // Connect when a language is chosen (machine enters 'connecting').
  const language = snapshot.context.language;
  const isConnecting = snapshot.value === 'connecting';
  useEffect(() => {
    if (!isConnecting || !language) return;
    let cancelled = false;

    (async () => {
      try {
        const session = await getRealtimeSession(language);
        if (cancelled) return;
        const audioEl = audioRef.current;
        if (!audioEl) {
          send({ type: 'ERROR', message: '音訊元件未就緒' });
          return;
        }
        const conn = await connectRealtime({
          session,
          remoteAudio: audioEl,
          greet: true,
          onEvent: (evt) => {
            switch (evt.kind) {
              case 'user_transcript':
                if (evt.text.trim()) send({ type: 'USER_MESSAGE', text: evt.text });
                break;
              case 'kero_speaking_start':
                send({ type: 'SET_SPEAKER', speaker: 'kero' });
                setKeroInterim('');
                break;
              case 'kero_delta':
                setKeroInterim((prev) => prev + evt.text);
                break;
              case 'kero_done':
                if (evt.text.trim()) send({ type: 'KERO_MESSAGE', text: evt.text });
                setKeroInterim('');
                break;
              case 'kero_speaking_done':
                send({ type: 'SET_SPEAKER', speaker: null });
                break;
              case 'error':
                send({ type: 'ERROR', message: evt.message });
                break;
            }
          },
        });
        if (cancelled) { conn.disconnect(); return; }
        connRef.current = conn;
        send({ type: 'CONNECTED' });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof DOMException && err.name === 'NotAllowedError'
          ? MIC_DENIED_MSG
          : err instanceof Error ? err.message : '連線失敗';
        send({ type: 'ERROR', message: msg });
      }
    })();

    return () => { cancelled = true; };
  }, [isConnecting, language, send]);

  // Tear down the connection when leaving 'live'.
  const isLive = snapshot.value === 'live';
  useEffect(() => {
    if (!isLive && connRef.current) {
      connRef.current.disconnect();
      connRef.current = null;
      setKeroInterim('');
    }
  }, [isLive]);

  // Guarantee disconnect on unmount regardless of machine state.
  // (Empty deps: cleanup runs only on unmount, so it never tears down a
  // connection that the connect effect just established.)
  useEffect(() => {
    return () => {
      connRef.current?.disconnect();
      connRef.current = null;
    };
  }, []);

  // Track whether push-to-talk is currently active so pttUp is idempotent —
  // pointerup / pointerleave / pointercancel can all fire, and a leave without
  // a prior press must NOT commit an empty audio buffer.
  const talkingRef = useRef(false);

  const pttDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (talkingRef.current) return;
    // Capture the pointer so the whole press stays bound to this button.
    // Without capture, a tiny drift off the button fires pointerleave and
    // cuts the recording short before the user has finished speaking.
    e.currentTarget.setPointerCapture(e.pointerId);
    talkingRef.current = true;
    connRef.current?.startTalking();
    send({ type: 'SET_SPEAKER', speaker: 'user' });
  }, [send]);

  const pttUp = useCallback(() => {
    if (!talkingRef.current) return;
    talkingRef.current = false;
    connRef.current?.stopTalking();
    send({ type: 'SET_SPEAKER', speaker: null });
  }, [send]);

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

      {/* Hidden element that plays Kero's streamed voice. */}
      <audio ref={audioRef} autoPlay hidden />
    </main>
  );
}

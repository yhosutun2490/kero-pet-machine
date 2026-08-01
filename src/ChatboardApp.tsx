import { useEffect, useRef, useState, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { chatMachine } from './machines/chatMachine';
import {
  getRealtimeSession,
  connectRealtime,
  type RealtimeConnection,
} from './lib/realtime';
import ChatPage from '@/components/ChatPage';
import SettingsPage from '@/components/SettingsPage';
import AppSidebar, { type ChatboardView } from '@/components/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useSettings } from '@/hooks/useSettings';
import type { Settings } from '@/lib/settings';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const MIC_DENIED_MSG =
  '無法存取麥克風。請前往「系統設定 → 隱私權與安全性 → 麥克風」，允許 Kero 使用麥克風。';

export default function ChatboardApp() {
  const [snapshot, send] = useMachine(chatMachine);
  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);

  // Streaming interim transcript for Kero's current turn.
  const [keroInterim, setKeroInterim] = useState('');

  // Which View the sidebar has selected. No routing — in-window state only.
  const [activeView, setActiveView] = useState<ChatboardView>('practice');

  // Current machine state value, read by the (dependency-light) Save handler.
  const snapshotValueRef = useRef(snapshot.value);
  snapshotValueRef.current = snapshot.value;

  // Persisted model/voice. Read through a ref inside the connect effect so a
  // Save doesn't re-trigger connect — it takes effect on the next connect.
  // (Live reconnect-on-Save is ticket 04.)
  const [settings, saveSettings] = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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

  // Connect when a language is chosen (machine enters 'connecting'). Also
  // re-runs on a settings-driven reconnect: RECONNECT bumps reconnectNonce, and
  // nonce > 0 means "mid-conversation reconnect" so we skip the greeting.
  const language = snapshot.context.language;
  const isConnecting = snapshot.value === 'connecting';
  const reconnectNonce = snapshot.context.reconnectNonce;
  useEffect(() => {
    if (!isConnecting || !language) return;
    let cancelled = false;

    (async () => {
      try {
        const session = await getRealtimeSession(language, settingsRef.current);
        if (cancelled) return;
        const audioEl = audioRef.current;
        if (!audioEl) {
          send({ type: 'ERROR', message: '音訊元件未就緒' });
          return;
        }
        const conn = await connectRealtime({
          session,
          remoteAudio: audioEl,
          greet: reconnectNonce === 0,
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
  }, [isConnecting, language, reconnectNonce, send]);

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

  // Persist a settings change and, if a conversation is already live or
  // connecting, reconnect it so the new model/voice takes effect immediately.
  // Otherwise the saved value simply applies on the next connect.
  const handleSaveSettings = useCallback(
    (next: Settings) => {
      saveSettings(next);
      const value = snapshotValueRef.current;
      if (value === 'live' || value === 'connecting') {
        send({ type: 'RECONNECT' });
      }
    },
    [saveSettings, send],
  );

  // Leaving the Practice View while push-to-talk is held must auto-end the
  // recording (equivalent to releasing the mic); pttUp is idempotent so this
  // is a no-op when not talking. The connection itself stays up — this only
  // closes the open audio turn.
  useEffect(() => {
    if (activeView !== 'practice') pttUp();
  }, [activeView, pttUp]);

  return (
    <SidebarProvider style={{ '--sidebar-width': '11rem' } as React.CSSProperties}>
      <AppSidebar active={activeView} onSelect={setActiveView} />

      <div className="flex-1 min-w-0">
        {activeView === 'practice' ? (
          <ChatPage
            snapshot={snapshot}
            send={send}
            pttDown={pttDown}
            pttUp={pttUp}
            keroInterim={keroInterim}
          />
        ) : (
          <SettingsPage saved={settings} onSave={handleSaveSettings} />
        )}
      </div>

      {/* Hidden element that plays Kero's streamed voice. Lives in the Shell so
          it survives View switches. */}
      <audio ref={audioRef} autoPlay hidden />
    </SidebarProvider>
  );
}

import { useEffect } from 'react';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export default function ChatboardApp() {
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    // Eagerly import emit so it's ready before beforeunload fires
    let emitFn: ((event: string) => Promise<void>) | null = null;
    import('@tauri-apps/api/event').then(({ emit }) => { emitFn = emit; });

    // Emit chat-closed when the window is about to unload
    const handleBeforeUnload = () => { emitFn?.('chat-closed'); };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Chatboard coming soon</h1>
    </main>
  );
}

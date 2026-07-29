import { useEffect } from 'react';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export default function ChatboardApp() {
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

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Chatboard coming soon</h1>
    </main>
  );
}

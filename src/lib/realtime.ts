/// <reference types="vite/client" />

export type Lang = 'en' | 'es';

export interface RealtimeSession {
  value: string; // ephemeral client secret (ek_...)
  expires_at?: number;
}

const SESSION_URL = import.meta.env.VITE_SESSION_URL ?? 'http://127.0.0.1:8787';

/**
 * The single seam for obtaining a Realtime session. Phase 1 hits the local
 * Express server; Phase 2 only changes VITE_SESSION_URL to the deployed host.
 */
export async function getRealtimeSession(lang: Lang): Promise<RealtimeSession> {
  const res = await fetch(`${SESSION_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  });
  if (!res.ok) {
    throw new Error(`session request failed: ${res.status}`);
  }
  return (await res.json()) as RealtimeSession;
}

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRealtimeSession } from './realtime';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('getRealtimeSession', () => {
  it('POSTs lang to the session URL and returns the ephemeral value', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: 'ek_abc', expires_at: 1 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const session = await getRealtimeSession('en');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/session');
    expect(JSON.parse(init.body as string)).toEqual({ lang: 'en' });
    expect(session.value).toBe('ek_abc');
  });

  it('throws when the server responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    await expect(getRealtimeSession('es')).rejects.toThrow(/session request failed: 502/);
  });
});

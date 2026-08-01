import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRealtimeSession, parseRealtimeEvent } from './realtime';

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

describe('parseRealtimeEvent', () => {
  it('maps user input transcription to a user_transcript', () => {
    const e = parseRealtimeEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hello Kero',
    });
    expect(e).toEqual({ kind: 'user_transcript', text: 'Hello Kero' });
  });

  it('maps kero audio transcript delta (both naming variants)', () => {
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.delta', delta: 'Hi' }))
      .toEqual({ kind: 'kero_delta', text: 'Hi' });
    expect(parseRealtimeEvent({ type: 'response.output_audio_transcript.delta', delta: 'Hi' }))
      .toEqual({ kind: 'kero_delta', text: 'Hi' });
  });

  it('maps kero transcript done to kero_done with full text', () => {
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.done', transcript: 'Hi there' }))
      .toEqual({ kind: 'kero_done', text: 'Hi there' });
  });

  it('maps response lifecycle to speaking start/stop', () => {
    expect(parseRealtimeEvent({ type: 'response.created' })).toEqual({ kind: 'kero_speaking_start' });
    expect(parseRealtimeEvent({ type: 'response.done' })).toEqual({ kind: 'kero_speaking_done' });
  });

  it('maps error events', () => {
    expect(parseRealtimeEvent({ type: 'error', error: { message: 'boom' } }))
      .toEqual({ kind: 'error', message: 'boom' });
  });

  it('returns other for unknown events', () => {
    expect(parseRealtimeEvent({ type: 'something.else' })).toEqual({ kind: 'other' });
  });
});

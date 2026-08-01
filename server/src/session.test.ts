import { describe, it, expect } from 'vitest';
import { buildSessionBody, mintSession } from './session';

describe('buildSessionBody', () => {
  it('sets model, cedar voice, gpt-4o-transcribe, and no turn_detection (push-to-talk)', () => {
    const body = buildSessionBody('en');
    expect(body.session.model).toBe('gpt-realtime');
    expect(body.session.audio.output.voice).toBe('cedar');
    expect(body.session.audio.input.transcription.model).toBe('gpt-4o-transcribe');
    expect(body.session.audio.input.turn_detection).toBeNull();
  });

  it('puts the target language into instructions', () => {
    expect(buildSessionBody('en').session.instructions).toContain('English');
    expect(buildSessionBody('es').session.instructions).toContain('Spanish');
  });

  it('uses a provided model and voice', () => {
    const body = buildSessionBody('en', { model: 'gpt-realtime-mini', voice: 'marin' });
    expect(body.session.model).toBe('gpt-realtime-mini');
    expect(body.session.audio.output.voice).toBe('marin');
  });

  it('throws on an unknown model', () => {
    expect(() => buildSessionBody('en', { model: 'gpt-4o' as never, voice: 'cedar' })).toThrow(
      /unknown model/,
    );
  });

  it('throws on an unknown voice', () => {
    expect(() =>
      buildSessionBody('en', { model: 'gpt-realtime', voice: 'nova' as never }),
    ).toThrow(/unknown voice/);
  });
});

describe('mintSession', () => {
  it('POSTs to OpenAI with the api key and returns the ephemeral value', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit = {};
    const fakeFetch = async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ value: 'ek_test123', expires_at: 999 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const result = await mintSession({ apiKey: 'sk-abc', lang: 'en', fetchImpl: fakeFetch as typeof fetch });
    expect(capturedUrl).toContain('/v1/realtime/client_secrets');
    expect((capturedInit.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc');
    expect(result.value).toBe('ek_test123');
  });

  it('throws with a clear message when OpenAI returns non-2xx', async () => {
    const fakeFetch = async () =>
      new Response('bad request detail', { status: 400 });
    await expect(
      mintSession({ apiKey: 'sk-abc', lang: 'en', fetchImpl: fakeFetch as typeof fetch }),
    ).rejects.toThrow(/OpenAI session mint failed: 400/);
  });

  it('throws a clear error when the response is missing a string value', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await expect(
      mintSession({ apiKey: 'sk-abc', lang: 'en', fetchImpl: fakeFetch as typeof fetch }),
    ).rejects.toThrow(/Unexpected session response shape/);
  });
});

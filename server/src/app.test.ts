import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { Lang, MintResult } from './session';

function appWith(mint: (lang: Lang) => Promise<MintResult>) {
  return createApp({ mint });
}

describe('POST /session', () => {
  it('returns 400 when lang is missing or invalid', async () => {
    const app = appWith(async () => ({ value: 'ek_x' }));
    const res = await request(app).post('/session').send({});
    expect(res.status).toBe(400);
  });

  it('returns the ephemeral session on success', async () => {
    const app = appWith(async () => ({ value: 'ek_ok' }));
    const res = await request(app).post('/session').send({ lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('ek_ok');
  });

  it('returns 502 when minting throws', async () => {
    const app = appWith(async () => {
      throw new Error('OpenAI session mint failed: 400 nope');
    });
    const res = await request(app).post('/session').send({ lang: 'es' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('mint failed');
  });
});

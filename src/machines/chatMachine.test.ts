import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { chatMachine } from './chatMachine';

function connected(lang: 'en' | 'es' = 'en') {
  const actor = createActor(chatMachine).start();
  actor.send({ type: 'SELECT_LANGUAGE', lang });
  actor.send({ type: 'CONNECTED' });
  return actor;
}

describe('initial state', () => {
  it('starts in selectingLanguage with empty context', () => {
    const s = createActor(chatMachine).start().getSnapshot();
    expect(s.value).toBe('selectingLanguage');
    expect(s.context.language).toBeNull();
    expect(s.context.messages).toEqual([]);
    expect(s.context.speaker).toBeNull();
    expect(s.context.error).toBeNull();
  });
});

describe('SELECT_LANGUAGE', () => {
  it('sets language and moves to connecting', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'es' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('connecting');
    expect(s.context.language).toBe('es');
  });
});

describe('connecting', () => {
  it('CONNECTED moves to live', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'CONNECTED' });
    expect(actor.getSnapshot().value).toBe('live');
  });

  it('ERROR moves to error and records the message', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'ERROR', message: 'mic denied' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('error');
    expect(s.context.error).toBe('mic denied');
  });
});

describe('live', () => {
  it('USER_MESSAGE appends a user message', () => {
    const actor = connected();
    actor.send({ type: 'USER_MESSAGE', text: 'Hello' });
    expect(actor.getSnapshot().context.messages).toEqual([{ role: 'user', text: 'Hello' }]);
  });

  it('KERO_MESSAGE appends a kero message', () => {
    const actor = connected();
    actor.send({ type: 'KERO_MESSAGE', text: 'Hi there' });
    expect(actor.getSnapshot().context.messages).toEqual([{ role: 'kero', text: 'Hi there' }]);
  });

  it('SET_SPEAKER updates who is speaking', () => {
    const actor = connected();
    actor.send({ type: 'SET_SPEAKER', speaker: 'kero' });
    expect(actor.getSnapshot().context.speaker).toBe('kero');
    actor.send({ type: 'SET_SPEAKER', speaker: null });
    expect(actor.getSnapshot().context.speaker).toBeNull();
  });

  it('END moves to ended', () => {
    const actor = connected();
    actor.send({ type: 'END' });
    expect(actor.getSnapshot().value).toBe('ended');
  });

  it('ERROR moves to error', () => {
    const actor = connected();
    actor.send({ type: 'ERROR', message: 'dropped' });
    expect(actor.getSnapshot().value).toBe('error');
    expect(actor.getSnapshot().context.error).toBe('dropped');
  });
});

describe('RESTART', () => {
  it('from ended resets to selectingLanguage with clean context', () => {
    const actor = connected('es');
    actor.send({ type: 'USER_MESSAGE', text: 'x' });
    actor.send({ type: 'END' });
    actor.send({ type: 'RESTART' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('selectingLanguage');
    expect(s.context.language).toBeNull();
    expect(s.context.messages).toEqual([]);
  });

  it('from error resets to selectingLanguage', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'ERROR', message: 'boom' });
    actor.send({ type: 'RESTART' });
    expect(actor.getSnapshot().value).toBe('selectingLanguage');
    expect(actor.getSnapshot().context.error).toBeNull();
  });
});

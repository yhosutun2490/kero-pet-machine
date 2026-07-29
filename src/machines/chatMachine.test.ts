import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { chatMachine } from './chatMachine';

describe('initial state', () => {
  it('starts in selectingLanguage with empty context', () => {
    const actor = createActor(chatMachine).start();
    const s = actor.getSnapshot();
    expect(s.value).toBe('selectingLanguage');
    expect(s.context.language).toBeNull();
    expect(s.context.messages).toEqual([]);
    expect(s.context.currentUtterance).toBe('');
  });
});

describe('SELECT_LANGUAGE', () => {
  it('English: transitions to speaking and sets language + currentUtterance + kero message', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('speaking');
    expect(s.context.language).toBe('en');
    expect(s.context.currentUtterance).toBe('Hello! How are you today?');
    expect(s.context.messages).toEqual([
      { role: 'kero', text: 'Hello! How are you today?' },
    ]);
  });

  it('Spanish: transitions to speaking with Spanish opening line', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'es' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('speaking');
    expect(s.context.language).toBe('es');
    expect(s.context.currentUtterance).toBe('¡Hola! ¿Cómo estás hoy?');
    expect(s.context.messages).toEqual([
      { role: 'kero', text: '¡Hola! ¿Cómo estás hoy?' },
    ]);
  });
});

describe('SPEECH_END', () => {
  it('transitions from speaking to idle', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    expect(actor.getSnapshot().value).toBe('speaking');
    actor.send({ type: 'SPEECH_END' });
    expect(actor.getSnapshot().value).toBe('idle');
  });
});

describe('TAP_MIC', () => {
  it('transitions from idle to listening', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'SPEECH_END' });
    expect(actor.getSnapshot().value).toBe('idle');
    actor.send({ type: 'TAP_MIC' });
    expect(actor.getSnapshot().value).toBe('listening');
  });

  it('is ignored in selectingLanguage', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'TAP_MIC' });
    expect(actor.getSnapshot().value).toBe('selectingLanguage');
  });

  it('TAP_MIC during speaking is silently ignored', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    expect(actor.getSnapshot().value).toBe('speaking'); // guard
    actor.send({ type: 'TAP_MIC' }); // should be ignored
    expect(actor.getSnapshot().value).toBe('speaking');
  });
});

describe('SPEECH_RESULT', () => {
  it('transitions from listening to processing and appends user message', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'SPEECH_END' });
    actor.send({ type: 'TAP_MIC' });
    actor.send({ type: 'SPEECH_RESULT', text: 'I am fine, thank you!' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('processing');
    expect(s.context.messages).toEqual([
      { role: 'kero', text: 'Hello! How are you today?' },
      { role: 'user', text: 'I am fine, thank you!' },
    ]);
  });
});

describe('RESPONSE_READY', () => {
  it('transitions from processing to speaking and appends kero message', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'SPEECH_END' });
    actor.send({ type: 'TAP_MIC' });
    actor.send({ type: 'SPEECH_RESULT', text: 'I am fine, thank you!' });
    actor.send({ type: 'RESPONSE_READY', text: 'That is great to hear!' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('speaking');
    expect(s.context.currentUtterance).toBe('That is great to hear!');
    expect(s.context.messages).toEqual([
      { role: 'kero', text: 'Hello! How are you today?' },
      { role: 'user', text: 'I am fine, thank you!' },
      { role: 'kero', text: 'That is great to hear!' },
    ]);
  });
});

describe('full conversation loop', () => {
  it('cycles speaking → idle → listening → processing → speaking → idle', () => {
    const actor = createActor(chatMachine).start();

    // Language selection
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    expect(actor.getSnapshot().value).toBe('speaking');

    // Kero finishes speaking
    actor.send({ type: 'SPEECH_END' });
    expect(actor.getSnapshot().value).toBe('idle');

    // User taps mic
    actor.send({ type: 'TAP_MIC' });
    expect(actor.getSnapshot().value).toBe('listening');

    // User speaks
    actor.send({ type: 'SPEECH_RESULT', text: 'Hola!' });
    expect(actor.getSnapshot().value).toBe('processing');

    // AI responds
    actor.send({ type: 'RESPONSE_READY', text: 'Muy bien!' });
    expect(actor.getSnapshot().value).toBe('speaking');
    expect(actor.getSnapshot().context.currentUtterance).toBe('Muy bien!');

    // Second round
    actor.send({ type: 'SPEECH_END' });
    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'TAP_MIC' });
    expect(actor.getSnapshot().value).toBe('listening');

    actor.send({ type: 'SPEECH_RESULT', text: 'How is the weather?' });
    expect(actor.getSnapshot().value).toBe('processing');

    actor.send({ type: 'RESPONSE_READY', text: 'Sunny and warm!' });
    expect(actor.getSnapshot().value).toBe('speaking');

    // Messages array has grown correctly
    const { messages } = actor.getSnapshot().context;
    expect(messages).toHaveLength(5);
    expect(messages[0]).toEqual({ role: 'kero', text: 'Hello! How are you today?' });
    expect(messages[1]).toEqual({ role: 'user', text: 'Hola!' });
    expect(messages[2]).toEqual({ role: 'kero', text: 'Muy bien!' });
    expect(messages[3]).toEqual({ role: 'user', text: 'How is the weather?' });
    expect(messages[4]).toEqual({ role: 'kero', text: 'Sunny and warm!' });
  });
});

describe('SPEECH_CANCEL', () => {
  it('transitions from listening back to idle', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'SPEECH_END' });
    actor.send({ type: 'TAP_MIC' });
    expect(actor.getSnapshot().value).toBe('listening');
    actor.send({ type: 'SPEECH_CANCEL' });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('does not change messages when cancelled', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'en' });
    actor.send({ type: 'SPEECH_END' });
    const messagesBefore = actor.getSnapshot().context.messages.length;
    actor.send({ type: 'TAP_MIC' });
    actor.send({ type: 'SPEECH_CANCEL' });
    expect(actor.getSnapshot().context.messages.length).toBe(messagesBefore);
  });
});

describe('currentUtterance is set on speaking entry', () => {
  it('is set by SELECT_LANGUAGE and later by RESPONSE_READY', () => {
    const actor = createActor(chatMachine).start();
    actor.send({ type: 'SELECT_LANGUAGE', lang: 'es' });
    expect(actor.getSnapshot().context.currentUtterance).toBe('¡Hola! ¿Cómo estás hoy?');

    actor.send({ type: 'SPEECH_END' });
    actor.send({ type: 'TAP_MIC' });
    actor.send({ type: 'SPEECH_RESULT', text: 'Buenos días' });
    actor.send({ type: 'RESPONSE_READY', text: '¡Buenos días a ti también!' });
    expect(actor.getSnapshot().context.currentUtterance).toBe('¡Buenos días a ti también!');
  });
});

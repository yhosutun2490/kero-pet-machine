import { setup, assign } from 'xstate';

export type Speaker = 'user' | 'kero' | null;

export interface ChatContext {
  language: 'en' | 'es' | null;
  messages: { role: 'kero' | 'user'; text: string }[];
  speaker: Speaker;
  error: string | null;
}

export type ChatEvent =
  | { type: 'SELECT_LANGUAGE'; lang: 'en' | 'es' }
  | { type: 'CONNECTED' }
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'KERO_MESSAGE'; text: string }
  | { type: 'SET_SPEAKER'; speaker: Speaker }
  | { type: 'END' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESTART' };

export function createInitialChatContext(): ChatContext {
  return { language: null, messages: [], speaker: null, error: null };
}

export const chatMachine = setup({
  types: {} as { context: ChatContext; events: ChatEvent },
  actions: {
    setLanguage: assign(({ event }) => {
      const e = event as Extract<ChatEvent, { type: 'SELECT_LANGUAGE' }>;
      return { language: e.lang };
    }),
    appendUserMessage: assign(({ context, event }) => {
      const e = event as Extract<ChatEvent, { type: 'USER_MESSAGE' }>;
      return { messages: [...context.messages, { role: 'user' as const, text: e.text }] };
    }),
    appendKeroMessage: assign(({ context, event }) => {
      const e = event as Extract<ChatEvent, { type: 'KERO_MESSAGE' }>;
      return { messages: [...context.messages, { role: 'kero' as const, text: e.text }] };
    }),
    setSpeaker: assign(({ event }) => {
      const e = event as Extract<ChatEvent, { type: 'SET_SPEAKER' }>;
      return { speaker: e.speaker };
    }),
    setError: assign(({ event }) => {
      const e = event as Extract<ChatEvent, { type: 'ERROR' }>;
      return { error: e.message, speaker: null };
    }),
    reset: assign(() => createInitialChatContext()),
  },
}).createMachine({
  id: 'chat',
  context: () => createInitialChatContext(),
  initial: 'selectingLanguage',
  states: {
    selectingLanguage: {
      on: {
        SELECT_LANGUAGE: { target: 'connecting', actions: 'setLanguage' },
      },
    },
    connecting: {
      on: {
        CONNECTED: { target: 'live' },
        ERROR: { target: 'error', actions: 'setError' },
      },
    },
    live: {
      on: {
        USER_MESSAGE: { actions: 'appendUserMessage' },
        KERO_MESSAGE: { actions: 'appendKeroMessage' },
        SET_SPEAKER: { actions: 'setSpeaker' },
        END: { target: 'ended' },
        ERROR: { target: 'error', actions: 'setError' },
      },
    },
    ended: {
      on: { RESTART: { target: 'selectingLanguage', actions: 'reset' } },
    },
    error: {
      on: { RESTART: { target: 'selectingLanguage', actions: 'reset' } },
    },
  },
});

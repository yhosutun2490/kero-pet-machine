import { setup, assign } from 'xstate';

export interface ChatContext {
  language: 'en' | 'es' | null;
  messages: { role: 'kero' | 'user'; text: string }[];
  // Persists through idle/listening so UI can display the last utterance
  currentUtterance: string;
}

export type ChatEvent =
  | { type: 'SELECT_LANGUAGE'; lang: 'en' | 'es' }
  | { type: 'TAP_MIC' }
  | { type: 'SPEECH_RESULT'; text: string }
  | { type: 'SPEECH_CANCEL' }
  | { type: 'RESPONSE_READY'; text: string }
  | { type: 'SPEECH_END' };

const OPENING_LINES: Record<'en' | 'es', string> = {
  en: 'Hello! How are you today?',
  es: '¡Hola! ¿Cómo estás hoy?',
};

export function createInitialChatContext(): ChatContext {
  return {
    language: null,
    messages: [],
    currentUtterance: '',
  };
}

export const chatMachine = setup({
  types: {} as {
    context: ChatContext;
    events: ChatEvent;
  },
  actions: {
    setLanguageAndGreet: assign(({ event }) => {
      const e = event as Extract<ChatEvent, { type: 'SELECT_LANGUAGE' }>;
      const text = OPENING_LINES[e.lang] ?? '';
      return {
        language: e.lang,
        currentUtterance: OPENING_LINES[e.lang] ?? '',
        messages: [{ role: 'kero' as const, text }],
      };
    }),
    appendUserMessage: assign(({ context, event }) => {
      const e = event as Extract<ChatEvent, { type: 'SPEECH_RESULT' }>;
      return {
        messages: [...context.messages, { role: 'user' as const, text: e.text }],
      };
    }),
    setResponseUtterance: assign(({ context, event }) => {
      const e = event as Extract<ChatEvent, { type: 'RESPONSE_READY' }>;
      return {
        currentUtterance: e.text,
        messages: [...context.messages, { role: 'kero' as const, text: e.text }],
      };
    }),
  },
}).createMachine({
  id: 'chat',
  context: () => createInitialChatContext(),
  initial: 'selectingLanguage',
  states: {
    selectingLanguage: {
      on: {
        SELECT_LANGUAGE: {
          target: 'speaking',
          actions: 'setLanguageAndGreet',
        },
      },
    },
    speaking: {
      on: {
        SPEECH_END: { target: 'idle' },
      },
    },
    idle: {
      on: {
        TAP_MIC: { target: 'listening' },
      },
    },
    listening: {
      on: {
        SPEECH_RESULT: {
          target: 'processing',
          actions: 'appendUserMessage',
        },
        SPEECH_CANCEL: { target: 'idle' },
      },
    },
    processing: {
      on: {
        RESPONSE_READY: {
          target: 'speaking',
          actions: 'setResponseUtterance',
        },
      },
    },
  },
});

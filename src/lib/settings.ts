/**
 * Chatboard settings: the realtime model and Kero's voice. The voice list is
 * grouped 男/女 for the Settings View; the values are OpenAI voice names.
 * These whitelists are the single client-side source of truth — the Settings
 * UI renders from them and stored values are validated against them.
 */

export const MODELS = ['gpt-realtime', 'gpt-realtime-mini'] as const;
export type Model = (typeof MODELS)[number];

export const MALE_VOICES = ['ash', 'cedar', 'verse'] as const;
export const FEMALE_VOICES = ['marin', 'coral', 'sage'] as const;
export const VOICES = [...MALE_VOICES, ...FEMALE_VOICES] as const;
export type Voice = (typeof VOICES)[number];

export type Gender = 'male' | 'female';

export interface Settings {
  model: Model;
  voice: Voice;
}

/** Matches the pre-settings hardcoded behaviour. */
export const DEFAULT_SETTINGS: Settings = { model: 'gpt-realtime', voice: 'cedar' };

export const STORAGE_KEY = 'kero.settings';

export function genderOf(voice: Voice): Gender {
  return (MALE_VOICES as readonly string[]).includes(voice) ? 'male' : 'female';
}

function isModel(v: unknown): v is Model {
  return typeof v === 'string' && (MODELS as readonly string[]).includes(v);
}

function isVoice(v: unknown): v is Voice {
  return typeof v === 'string' && (VOICES as readonly string[]).includes(v);
}

/**
 * Parse persisted settings. Any missing, malformed, or unknown value falls back
 * to the whole default — a stale stored value must never reach the server.
 */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object') {
      const { model, voice } = obj as Record<string, unknown>;
      if (isModel(model) && isVoice(voice)) return { model, voice };
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_SETTINGS;
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}

export type Lang = 'en' | 'es';

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Spanish' };

/** Realtime models offered in the Settings View. */
export const MODELS = ['gpt-realtime', 'gpt-realtime-mini'] as const;
/** Kero voices, grouped 男/女 in the UI. Server keeps a flat whitelist. */
export const VOICES = ['ash', 'cedar', 'verse', 'marin', 'coral', 'sage'] as const;

export type Model = (typeof MODELS)[number];
export type Voice = (typeof VOICES)[number];

/** Applied when the client omits a selection (matches pre-settings behaviour). */
export const DEFAULT_MODEL: Model = 'gpt-realtime';
export const DEFAULT_VOICE: Voice = 'cedar';

export interface VoiceModel {
  model: Model;
  voice: Voice;
}

export interface SessionBody {
  session: {
    type: 'realtime';
    model: string;
    instructions: string;
    audio: {
      input: {
        transcription: { model: string; language: string };
        turn_detection: null;
      };
      output: { voice: string };
    };
  };
}

export function buildSessionBody(
  lang: Lang,
  sel: VoiceModel = { model: DEFAULT_MODEL, voice: DEFAULT_VOICE },
): SessionBody {
  if (!(MODELS as readonly string[]).includes(sel.model)) {
    throw new Error(`unknown model: ${sel.model}`);
  }
  if (!(VOICES as readonly string[]).includes(sel.voice)) {
    throw new Error(`unknown voice: ${sel.voice}`);
  }
  const language = LANG_NAME[lang];
  return {
    session: {
      type: 'realtime',
      model: sel.model,
      instructions:
        `You are Kero, a friendly frog who is the user's conversation partner for ` +
        `practicing everyday spoken ${language}. Always speak in ${language}.\n\n` +
        `Have a natural, flowing conversation: react to what the user just said, then ` +
        `ask one simple follow-up question to keep the chat going. Keep each of your ` +
        `turns short (1-2 sentences) and use simple vocabulary suited to a learner.\n\n` +
        `Be warm and encouraging. When the user makes a mistake, briefly model the ` +
        `correct phrasing inside your natural reply and then move on — do not lecture. ` +
        `This is a conversation, NOT a pronunciation drill: do not repeatedly ask the ` +
        `user to repeat themselves or to pronounce words. If you genuinely could not ` +
        `understand, ask once in a friendly way, then carry on with the conversation.`,
      audio: {
        input: {
          // Pin the transcription language to the practice language. Without
          // this the model auto-detects and, on short or accented utterances,
          // sometimes transcribes as the wrong language. `lang` is already an
          // ISO-639-1 code ('en' / 'es').
          transcription: { model: 'gpt-4o-transcribe', language: lang },
          turn_detection: null,
        },
        output: { voice: sel.voice },
      },
    },
  };
}

export interface MintOptions {
  apiKey: string;
  lang: Lang;
  sel?: VoiceModel;
  fetchImpl?: typeof fetch;
}

export interface MintResult {
  value: string;
  expires_at?: number;
}

export async function mintSession(opts: MintOptions): Promise<MintResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSessionBody(opts.lang, opts.sel)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI session mint failed: ${res.status} ${detail}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.value !== 'string') {
    throw new Error(`Unexpected session response shape: ${JSON.stringify(json)}`);
  }
  return json as unknown as MintResult;
}

export type Lang = 'en' | 'es';

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Spanish' };

export interface SessionBody {
  session: {
    type: 'realtime';
    model: string;
    instructions: string;
    audio: {
      input: {
        transcription: { model: string };
        turn_detection: null;
      };
      output: { voice: string };
    };
  };
}

export function buildSessionBody(lang: Lang): SessionBody {
  const language = LANG_NAME[lang];
  return {
    session: {
      type: 'realtime',
      model: 'gpt-realtime',
      instructions:
        `You are Kero, a friendly frog who helps the user practice conversational ${language}. ` +
        `Always speak in ${language}. Keep sentences short and simple for a language learner, ` +
        `speak warmly and encouragingly, and gently correct mistakes when helpful.`,
      audio: {
        input: {
          transcription: { model: 'gpt-4o-transcribe' },
          turn_detection: null,
        },
        output: { voice: 'cedar' },
      },
    },
  };
}

export interface MintOptions {
  apiKey: string;
  lang: Lang;
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
    body: JSON.stringify(buildSessionBody(opts.lang)),
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

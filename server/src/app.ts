import express, { type Express } from 'express';
import cors from 'cors';
import {
  mintSession,
  MODELS,
  VOICES,
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  type Lang,
  type Model,
  type Voice,
  type VoiceModel,
  type MintResult,
} from './session.js';

export interface AppDeps {
  // Injected for testing; production passes the real minter.
  mint: (lang: Lang, sel: VoiceModel) => Promise<MintResult>;
}

const VALID_LANGS = new Set<Lang>(['en', 'es']);
const VALID_MODELS = new Set<string>(MODELS);
const VALID_VOICES = new Set<string>(VOICES);

export function createApp(deps: AppDeps): Express {
  const app = express();
  // Permissive during development; Phase 2 will restrict origins before deploy.
  app.use(cors());
  app.use(express.json());

  app.post('/session', async (req, res) => {
    const lang: unknown = req.body?.lang;
    if (typeof lang !== 'string' || !VALID_LANGS.has(lang as Lang)) {
      res.status(400).json({ error: 'lang must be "en" or "es"' });
      return;
    }

    // model/voice are optional; absent means the pre-settings defaults. When
    // present they must be whitelisted — a bad client is a 400, not a 502.
    const model = (req.body?.model ?? DEFAULT_MODEL) as unknown;
    const voice = (req.body?.voice ?? DEFAULT_VOICE) as unknown;
    if (typeof model !== 'string' || !VALID_MODELS.has(model)) {
      res.status(400).json({ error: `unknown model: ${String(model)}` });
      return;
    }
    if (typeof voice !== 'string' || !VALID_VOICES.has(voice)) {
      res.status(400).json({ error: `unknown voice: ${String(voice)}` });
      return;
    }

    try {
      const session = await deps.mint(lang as Lang, {
        model: model as Model,
        voice: voice as Voice,
      });
      res.status(200).json(session);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'mint failed' });
    }
  });

  return app;
}

export function defaultMinter(apiKey: string) {
  return (lang: Lang, sel: VoiceModel) => mintSession({ apiKey, lang, sel });
}

import express, { type Express } from 'express';
import cors from 'cors';
import { mintSession, type Lang, type MintResult } from './session.js';

export interface AppDeps {
  // Injected for testing; production passes the real minter.
  mint: (lang: Lang) => Promise<MintResult>;
}

const VALID_LANGS = new Set<Lang>(['en', 'es']);

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.post('/session', async (req, res) => {
    const lang = req.body?.lang;
    if (!VALID_LANGS.has(lang)) {
      res.status(400).json({ error: 'lang must be "en" or "es"' });
      return;
    }
    try {
      const session = await deps.mint(lang);
      res.status(200).json(session);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'mint failed' });
    }
  });

  return app;
}

export function defaultMinter(apiKey: string) {
  return (lang: Lang) => mintSession({ apiKey, lang });
}

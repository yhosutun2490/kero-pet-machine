import 'dotenv/config';
import { createApp, defaultMinter } from './app.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Missing OPENAI_API_KEY. Copy server/.env.example to server/.env and set it.');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
const app = createApp({ mint: defaultMinter(apiKey) });
app.listen(port, () => {
  console.log(`[kero-session-server] listening on http://127.0.0.1:${port}`);
});

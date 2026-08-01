# Realtime 語音對話 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 OpenAI Realtime API（`gpt-realtime`，voice-to-voice、push-to-talk）取代在 WKWebView 無法運作的 Web Speech API，讓 Kero 對話練習能真正語音互動。

**Architecture:** 一支獨立的 Express server（dev/prod 共用）持有真 `OPENAI_API_KEY`，透過 `POST /session` 鑄造 ~1 分鐘有效的 ephemeral key；前端用該 key 以 WebRTC 直連 OpenAI Realtime，麥克風採按住說話。xstate 狀態機重構為連線生命週期（selectingLanguage → connecting → live → ended/error）。

**Tech Stack:** Express + TypeScript（server）、React 19 + xstate 5 + 瀏覽器原生 `RTCPeerConnection`（前端）、vitest（測試）、concurrently（dev 並行）。

**Spec:** `docs/superpowers/specs/2026-08-01-realtime-voice-chat-design.md`

**⚠️ 外部 API 核實：** OpenAI Realtime 的 `client_secrets` 請求/回應結構與 WebRTC `calls` 端點欄位會隨版本變動。本計畫的 `mintSession`（Task 1）與 `connectRealtime`（Task 5）以 GA（gpt-realtime）結構撰寫，但這兩處是**唯二**依賴外部 API 形狀的地方，已被隔離。Task 5 的手動 smoke test 會直接暴露形狀錯誤；若失敗，只需改這兩個函式。

---

## File Structure

**Server（新增，獨立 npm package）**
- `server/package.json` — server 相依與 script
- `server/tsconfig.json` — server TS 設定
- `server/.env.example` — `OPENAI_API_KEY`、`PORT`
- `server/src/session.ts` — `buildSessionBody(lang)`（純函式）、`mintSession(opts)`（呼叫 OpenAI，可注入 fetch）
- `server/src/app.ts` — `createApp(deps)` Express app factory（可測）
- `server/src/index.ts` — 讀 env、啟動 listen
- `server/src/session.test.ts`、`server/src/app.test.ts` — 測試

**前端**
- `src/lib/realtime.ts`（新）— `getRealtimeSession(lang)`（唯一取得 session 的接縫）、`parseRealtimeEvent(raw)`（純函式，可測）、`connectRealtime(...)` / `RealtimeConnection`（WebRTC）
- `src/lib/realtime.test.ts`（新）— 測 `getRealtimeSession` 與 `parseRealtimeEvent`
- `src/machines/chatMachine.ts`（重寫）— 新狀態
- `src/machines/chatMachine.test.ts`（重寫）— 新狀態測試
- `src/ChatboardApp.tsx`（改寫）— 接新機器 + realtime 模組；移除舊 STT/TTS/debug
- `src/lib/mockRespond.ts`（刪除）

**根**
- `package.json`（修改）— `dev` 用 concurrently 同起 server + vite；新增 `dev:server`
- `.env.example`（新）— `VITE_SESSION_URL`

---

## Task 1: Server session 邏輯（純函式 + 鑄造）

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.env.example`
- Create: `server/src/session.ts`
- Test: `server/src/session.test.ts`

- [ ] **Step 1: 建立 server package 骨架**

Create `server/package.json`:

```json
{
  "name": "kero-session-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Create `server/.env.example`:

```
OPENAI_API_KEY=sk-your-key-here
PORT=8787
```

- [ ] **Step 2: 安裝 server 相依**

Run: `cd server && npm install`
Expected: `node_modules/` 建立，無錯誤。

- [ ] **Step 3: 寫 failing test（session.test.ts）**

Create `server/src/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSessionBody, mintSession } from './session';

describe('buildSessionBody', () => {
  it('sets model, cedar voice, gpt-4o-transcribe, and no turn_detection (push-to-talk)', () => {
    const body = buildSessionBody('en');
    expect(body.session.model).toBe('gpt-realtime');
    expect(body.session.audio.output.voice).toBe('cedar');
    expect(body.session.audio.input.transcription.model).toBe('gpt-4o-transcribe');
    expect(body.session.audio.input.turn_detection).toBeNull();
  });

  it('puts the target language into instructions', () => {
    expect(buildSessionBody('en').session.instructions).toContain('English');
    expect(buildSessionBody('es').session.instructions).toContain('Spanish');
  });
});

describe('mintSession', () => {
  it('POSTs to OpenAI with the api key and returns the ephemeral value', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit = {};
    const fakeFetch = async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ value: 'ek_test123', expires_at: 999 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const result = await mintSession({ apiKey: 'sk-abc', lang: 'en', fetchImpl: fakeFetch as typeof fetch });
    expect(capturedUrl).toContain('/v1/realtime/client_secrets');
    expect((capturedInit.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc');
    expect(result.value).toBe('ek_test123');
  });

  it('throws with a clear message when OpenAI returns non-2xx', async () => {
    const fakeFetch = async () =>
      new Response('bad request detail', { status: 400 });
    await expect(
      mintSession({ apiKey: 'sk-abc', lang: 'en', fetchImpl: fakeFetch as typeof fetch }),
    ).rejects.toThrow(/OpenAI session mint failed: 400/);
  });
});
```

- [ ] **Step 4: 執行測試確認失敗**

Run: `cd server && npx vitest run src/session.test.ts`
Expected: FAIL（`session.ts` 尚未存在 / 匯出未定義）。

- [ ] **Step 5: 實作 session.ts**

Create `server/src/session.ts`:

```ts
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
  return (await res.json()) as MintResult;
}
```

- [ ] **Step 6: 執行測試確認通過**

Run: `cd server && npx vitest run src/session.test.ts`
Expected: PASS（4 個測試）。

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/tsconfig.json server/.env.example server/src/session.ts server/src/session.test.ts server/package-lock.json
git commit -m "feat(server): OpenAI Realtime ephemeral session minting logic"
```

---

## Task 2: Express app 與 /session 路由

**Files:**
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/src/app.test.ts`

- [ ] **Step 1: 寫 failing test（app.test.ts）**

Create `server/src/app.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

function appWith(mint: (lang: string) => Promise<{ value: string }>) {
  return createApp({ mint: mint as never });
}

describe('POST /session', () => {
  it('returns 400 when lang is missing or invalid', async () => {
    const app = appWith(async () => ({ value: 'ek_x' }));
    const res = await request(app).post('/session').send({});
    expect(res.status).toBe(400);
  });

  it('returns the ephemeral session on success', async () => {
    const app = appWith(async () => ({ value: 'ek_ok' }));
    const res = await request(app).post('/session').send({ lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('ek_ok');
  });

  it('returns 502 when minting throws', async () => {
    const app = appWith(async () => {
      throw new Error('OpenAI session mint failed: 400 nope');
    });
    const res = await request(app).post('/session').send({ lang: 'es' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('mint failed');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd server && npx vitest run src/app.test.ts`
Expected: FAIL（`app.ts` 不存在）。

- [ ] **Step 3: 實作 app.ts**

Create `server/src/app.ts`:

```ts
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd server && npx vitest run src/app.test.ts`
Expected: PASS（3 個測試）。

- [ ] **Step 5: 實作 index.ts（啟動）**

Create `server/src/index.ts`:

```ts
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
```

- [ ] **Step 6: 冒煙檢查啟動失敗訊息（無 key 時）**

Run: `cd server && node --import tsx src/index.ts`
Expected: 印出 `Missing OPENAI_API_KEY...` 並以非 0 結束（因為尚未設定 `.env`）。

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/app.test.ts
git commit -m "feat(server): /session Express route with validation and error mapping"
```

---

## Task 3: 根 dev script（concurrently）與環境變數

**Files:**
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: 安裝 concurrently（根）**

Run: `npm install -D concurrently`
Expected: 加入根 `devDependencies`。

- [ ] **Step 2: 修改根 package.json 的 dev script**

在 `package.json` 的 `scripts` 中，把：

```json
    "dev": "vite --host 127.0.0.1",
```

改為：

```json
    "dev": "concurrently -n vite,server -c cyan,green \"vite --host 127.0.0.1\" \"npm --prefix server run dev\"",
    "dev:server": "npm --prefix server run dev",
```

（`tauri.conf.json` 的 `beforeDevCommand` 已是 `npm run dev`，因此 `tauri dev` 會一併啟動 server。）

- [ ] **Step 3: 建立前端 .env.example**

Create `.env.example`:

```
# Base URL of the session-minting server (Express).
# Dev default matches server/.env.example PORT.
VITE_SESSION_URL=http://127.0.0.1:8787
```

- [ ] **Step 4: 驗證 concurrently 能同起（手動）**

先建立實際 env：`cp server/.env.example server/.env` 並填入真 `OPENAI_API_KEY`；`cp .env.example .env`。
Run: `npm run dev`
Expected: 同時看到 `[vite]` 與 `[kero-session-server] listening on http://127.0.0.1:8787`。確認後 Ctrl-C 結束。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: run Express session server alongside vite via concurrently"
```

---

## Task 4: 前端 getRealtimeSession 接縫

**Files:**
- Create: `src/lib/realtime.ts`
- Test: `src/lib/realtime.test.ts`

- [ ] **Step 1: 寫 failing test（getRealtimeSession 部分）**

Create `src/lib/realtime.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRealtimeSession } from './realtime';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('getRealtimeSession', () => {
  it('POSTs lang to the session URL and returns the ephemeral value', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: 'ek_abc', expires_at: 1 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const session = await getRealtimeSession('en');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/session');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ lang: 'en' });
    expect(session.value).toBe('ek_abc');
  });

  it('throws when the server responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    await expect(getRealtimeSession('es')).rejects.toThrow(/session request failed: 502/);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: FAIL（`realtime.ts` 不存在）。

- [ ] **Step 3: 實作 realtime.ts 的 getRealtimeSession**

Create `src/lib/realtime.ts`:

```ts
export type Lang = 'en' | 'es';

export interface RealtimeSession {
  value: string; // ephemeral client secret (ek_...)
  expires_at?: number;
}

const SESSION_URL = import.meta.env.VITE_SESSION_URL ?? 'http://127.0.0.1:8787';

/**
 * The single seam for obtaining a Realtime session. Phase 1 hits the local
 * Express server; Phase 2 only changes VITE_SESSION_URL to the deployed host.
 */
export async function getRealtimeSession(lang: Lang): Promise<RealtimeSession> {
  const res = await fetch(`${SESSION_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  });
  if (!res.ok) {
    throw new Error(`session request failed: ${res.status}`);
  }
  return (await res.json()) as RealtimeSession;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: PASS（2 個測試）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime.ts src/lib/realtime.test.ts
git commit -m "feat(web): getRealtimeSession seam calling the session server"
```

---

## Task 5: 前端 Realtime 事件解析 + WebRTC 連線

**Files:**
- Modify: `src/lib/realtime.ts`
- Modify: `src/lib/realtime.test.ts`

- [ ] **Step 1: 為 parseRealtimeEvent 寫 failing test**

在 `src/lib/realtime.test.ts` 末端加入：

```ts
import { parseRealtimeEvent } from './realtime';

describe('parseRealtimeEvent', () => {
  it('maps user input transcription to a user_transcript', () => {
    const e = parseRealtimeEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hello Kero',
    });
    expect(e).toEqual({ kind: 'user_transcript', text: 'Hello Kero' });
  });

  it('maps kero audio transcript delta (both naming variants)', () => {
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.delta', delta: 'Hi' }))
      .toEqual({ kind: 'kero_delta', text: 'Hi' });
    expect(parseRealtimeEvent({ type: 'response.output_audio_transcript.delta', delta: 'Hi' }))
      .toEqual({ kind: 'kero_delta', text: 'Hi' });
  });

  it('maps kero transcript done to kero_done with full text', () => {
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.done', transcript: 'Hi there' }))
      .toEqual({ kind: 'kero_done', text: 'Hi there' });
  });

  it('maps response lifecycle to speaking start/stop', () => {
    expect(parseRealtimeEvent({ type: 'response.created' })).toEqual({ kind: 'kero_speaking_start' });
    expect(parseRealtimeEvent({ type: 'response.done' })).toEqual({ kind: 'kero_speaking_done' });
  });

  it('maps error events', () => {
    expect(parseRealtimeEvent({ type: 'error', error: { message: 'boom' } }))
      .toEqual({ kind: 'error', message: 'boom' });
  });

  it('returns other for unknown events', () => {
    expect(parseRealtimeEvent({ type: 'something.else' })).toEqual({ kind: 'other' });
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: FAIL（`parseRealtimeEvent` 未定義）。

- [ ] **Step 3: 在 realtime.ts 實作 parseRealtimeEvent**

在 `src/lib/realtime.ts` 末端加入：

```ts
export type RealtimeUiEvent =
  | { kind: 'user_transcript'; text: string }
  | { kind: 'kero_delta'; text: string }
  | { kind: 'kero_done'; text: string }
  | { kind: 'kero_speaking_start' }
  | { kind: 'kero_speaking_done' }
  | { kind: 'error'; message: string }
  | { kind: 'other' };

/** Pure normaliser for Realtime data-channel server events. */
export function parseRealtimeEvent(raw: { type?: string; [k: string]: unknown }): RealtimeUiEvent {
  switch (raw.type) {
    case 'conversation.item.input_audio_transcription.completed':
      return { kind: 'user_transcript', text: String(raw.transcript ?? '') };
    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta':
      return { kind: 'kero_delta', text: String(raw.delta ?? '') };
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
      return { kind: 'kero_done', text: String(raw.transcript ?? '') };
    case 'response.created':
      return { kind: 'kero_speaking_start' };
    case 'response.done':
      return { kind: 'kero_speaking_done' };
    case 'error': {
      const error = raw.error as { message?: string } | undefined;
      return { kind: 'error', message: error?.message ?? 'realtime error' };
    }
    default:
      return { kind: 'other' };
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: 實作 connectRealtime（WebRTC，無單元測試——靠手動 smoke test）**

在 `src/lib/realtime.ts` 末端加入。此段依賴瀏覽器 WebRTC API 與 OpenAI 的 `calls` 端點形狀（見檔頭核實提醒）。

```ts
const REALTIME_MODEL = 'gpt-realtime';
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export interface RealtimeConnection {
  /** Enable the mic track (push-to-talk down). */
  startTalking: () => void;
  /** Disable the mic track and ask the model to respond (push-to-talk up). */
  stopTalking: () => void;
  /** Tear down the peer connection and mic. */
  disconnect: () => void;
}

export interface ConnectOptions {
  session: RealtimeSession;
  remoteAudio: HTMLAudioElement;
  onEvent: (event: RealtimeUiEvent) => void;
  /** Optional: send an initial response.create so Kero greets first. */
  greet?: boolean;
}

export async function connectRealtime(opts: ConnectOptions): Promise<RealtimeConnection> {
  const pc = new RTCPeerConnection();

  // Remote audio (Kero's voice)
  pc.ontrack = (e) => {
    opts.remoteAudio.srcObject = e.streams[0];
  };

  // Local mic — added but muted until push-to-talk.
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const micTrack = mic.getAudioTracks()[0];
  micTrack.enabled = false;
  pc.addTrack(micTrack, mic);

  // Data channel for events (both directions)
  const dc = pc.createDataChannel('oai-events');
  const send = (msg: unknown) => {
    if (dc.readyState === 'open') dc.send(JSON.stringify(msg));
  };
  dc.onmessage = (e) => {
    try {
      opts.onEvent(parseRealtimeEvent(JSON.parse(e.data)));
    } catch {
      /* ignore malformed frames */
    }
  };
  dc.onopen = () => {
    if (opts.greet) send({ type: 'response.create' });
  };

  // SDP offer/answer with OpenAI using the ephemeral key as bearer.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdpRes = await fetch(`${CALLS_URL}?model=${REALTIME_MODEL}`, {
    method: 'POST',
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${opts.session.value}`,
      'Content-Type': 'application/sdp',
    },
  });
  if (!sdpRes.ok) {
    pc.close();
    micTrack.stop();
    throw new Error(`realtime connect failed: ${sdpRes.status}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

  return {
    startTalking: () => { micTrack.enabled = true; },
    stopTalking: () => {
      micTrack.enabled = false;
      send({ type: 'input_audio_buffer.commit' });
      send({ type: 'response.create' });
    },
    disconnect: () => {
      micTrack.stop();
      pc.close();
    },
  };
}
```

- [ ] **Step 6: 型別檢查**

Run: `npm run typecheck`
Expected: 無錯誤。

- [ ] **Step 7: Commit**

```bash
git add src/lib/realtime.ts src/lib/realtime.test.ts
git commit -m "feat(web): Realtime event parser and WebRTC push-to-talk connection"
```

---

## Task 6: 重構 chatMachine 為連線生命週期

**Files:**
- Modify: `src/machines/chatMachine.ts`（整檔重寫）
- Modify: `src/machines/chatMachine.test.ts`（整檔重寫）

- [ ] **Step 1: 重寫 chatMachine.test.ts**

Replace `src/machines/chatMachine.test.ts` 全部內容為：

```ts
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/machines/chatMachine.test.ts`
Expected: FAIL（舊機器沒有這些狀態/事件）。

- [ ] **Step 3: 重寫 chatMachine.ts**

Replace `src/machines/chatMachine.ts` 全部內容為：

```ts
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/machines/chatMachine.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add src/machines/chatMachine.ts src/machines/chatMachine.test.ts
git commit -m "refactor(machine): chat state machine models realtime connection lifecycle"
```

---

## Task 7: 改寫 ChatboardApp 接 realtime + 新機器

**Files:**
- Modify: `src/ChatboardApp.tsx`（整檔重寫）

- [ ] **Step 1: 重寫 ChatboardApp.tsx**

Replace `src/ChatboardApp.tsx` 全部內容為：

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { chatMachine } from './machines/chatMachine';
import {
  getRealtimeSession,
  connectRealtime,
  type RealtimeConnection,
} from './lib/realtime';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const MIC_DENIED_MSG =
  '無法存取麥克風。請前往「系統設定 → 隱私權與安全性 → 麥克風」，允許 Kero 使用麥克風。';

export default function ChatboardApp() {
  const [snapshot, send] = useMachine(chatMachine);
  const bottomRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);

  // Streaming interim transcript for Kero's current turn.
  const [keroInterim, setKeroInterim] = useState('');

  // Emit chat-closed on window unload (keep existing Tauri behaviour).
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let cleanup: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ emit }) => {
      const handle = () => { emit('chat-closed'); };
      window.addEventListener('beforeunload', handle);
      cleanup = () => window.removeEventListener('beforeunload', handle);
    });
    return () => { cleanup?.(); };
  }, []);

  // Auto-scroll on new messages / interim text.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot.context.messages, keroInterim]);

  // Connect when a language is chosen (machine enters 'connecting').
  const language = snapshot.context.language;
  const isConnecting = snapshot.value === 'connecting';
  useEffect(() => {
    if (!isConnecting || !language) return;
    let cancelled = false;

    (async () => {
      try {
        const session = await getRealtimeSession(language);
        if (cancelled) return;
        const conn = await connectRealtime({
          session,
          remoteAudio: audioRef.current!,
          greet: true,
          onEvent: (evt) => {
            switch (evt.kind) {
              case 'user_transcript':
                if (evt.text.trim()) send({ type: 'USER_MESSAGE', text: evt.text });
                break;
              case 'kero_speaking_start':
                send({ type: 'SET_SPEAKER', speaker: 'kero' });
                setKeroInterim('');
                break;
              case 'kero_delta':
                setKeroInterim((prev) => prev + evt.text);
                break;
              case 'kero_done':
                if (evt.text.trim()) send({ type: 'KERO_MESSAGE', text: evt.text });
                setKeroInterim('');
                break;
              case 'kero_speaking_done':
                send({ type: 'SET_SPEAKER', speaker: null });
                break;
              case 'error':
                send({ type: 'ERROR', message: evt.message });
                break;
            }
          },
        });
        if (cancelled) { conn.disconnect(); return; }
        connRef.current = conn;
        send({ type: 'CONNECTED' });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof DOMException && err.name === 'NotAllowedError'
          ? MIC_DENIED_MSG
          : err instanceof Error ? err.message : '連線失敗';
        send({ type: 'ERROR', message: msg });
      }
    })();

    return () => { cancelled = true; };
  }, [isConnecting, language, send]);

  // Tear down the connection when leaving 'live'.
  const isLive = snapshot.value === 'live';
  useEffect(() => {
    if (!isLive && connRef.current) {
      connRef.current.disconnect();
      connRef.current = null;
      setKeroInterim('');
    }
  }, [isLive]);

  const pttDown = useCallback(() => {
    connRef.current?.startTalking();
    send({ type: 'SET_SPEAKER', speaker: 'user' });
  }, [send]);

  const pttUp = useCallback(() => {
    connRef.current?.stopTalking();
    send({ type: 'SET_SPEAKER', speaker: null });
  }, [send]);

  const speaker = snapshot.context.speaker;
  const keroSpeaking = speaker === 'kero';

  return (
    <main className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center px-4 py-3 border-b border-border shrink-0">
        <span className="text-lg font-semibold">🐸 Kero 對話練習</span>
      </header>

      {snapshot.value === 'selectingLanguage' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <p className="text-base text-muted-foreground">請選擇對話語言</p>
          <div className="flex gap-4">
            <Button size="lg" onClick={() => send({ type: 'SELECT_LANGUAGE', lang: 'en' })}>
              English
            </Button>
            <Button size="lg" variant="outline" onClick={() => send({ type: 'SELECT_LANGUAGE', lang: 'es' })}>
              Español
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="flex flex-col gap-3">
              {snapshot.context.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'kero' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    msg.role === 'kero'
                      ? 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-100'
                      : 'bg-secondary text-secondary-foreground'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {keroInterim ? (
                <div className="flex justify-start">
                  <div className="max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed bg-green-100/60 text-green-900/70 italic dark:bg-green-900/20">
                    {keroInterim}
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="flex flex-col items-center border-t border-border shrink-0">
            {snapshot.value === 'error' ? (
              <p className="text-xs text-red-500 px-4 pt-2">{snapshot.context.error}</p>
            ) : null}

            <div className="flex items-center justify-center px-4 py-3 gap-3 w-full">
              {snapshot.value === 'connecting' ? (
                <span className="text-sm text-muted-foreground">連線中…</span>
              ) : snapshot.value === 'live' ? (
                <>
                  <Button
                    size="icon-lg"
                    variant="outline"
                    disabled={keroSpeaking}
                    aria-label="按住說話"
                    aria-pressed={speaker === 'user'}
                    onPointerDown={pttDown}
                    onPointerUp={pttUp}
                    onPointerLeave={() => { if (speaker === 'user') pttUp(); }}
                    className={speaker === 'user' ? 'ring-2 ring-red-500 ring-offset-2 text-red-500' : ''}
                  >
                    🎤
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: 'END' })}>
                    結束
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => send({ type: 'RESTART' })}>
                  重新開始
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Hidden element that plays Kero's streamed voice. */}
      <audio ref={audioRef} autoPlay hidden />
    </main>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run typecheck`
Expected: 無錯誤（若 `import.meta.env` 報錯，確認 `vite/client` 型別；vite 專案預設已含）。

- [ ] **Step 3: Commit**

```bash
git add src/ChatboardApp.tsx
git commit -m "feat(web): drive chatboard with Realtime WebRTC + push-to-talk UI"
```

---

## Task 8: 清理舊碼 + 全量驗證

**Files:**
- Delete: `src/lib/mockRespond.ts`
- Verify: 全專案

- [ ] **Step 1: 確認 mockRespond 已無引用**

Run: `grep -rn "mockRespond" src`
Expected: 無輸出（Task 7 已移除）。若仍有，先移除引用。

- [ ] **Step 2: 刪除 mockRespond.ts 及其測試（若有）**

Run: `git rm src/lib/mockRespond.ts && (git rm src/lib/mockRespond.test.ts 2>/dev/null || true)`
Expected: 檔案刪除。

- [ ] **Step 3: 確認舊 API 殘留已清除**

Run: `grep -rn "webkitSpeechRecognition\|SpeechSynthesisUtterance\|DEBUG-mic" src`
Expected: 無輸出。

- [ ] **Step 4: 全量測試 + 型別檢查（前端與 server）**

Run: `npm test && npm run typecheck && cd server && npx vitest run`
Expected: 全部 PASS，型別無誤。

- [ ] **Step 5: 手動 smoke test（human-in-the-loop 驗收）**

前置：`server/.env` 已填真 `OPENAI_API_KEY`；`.env` 有 `VITE_SESSION_URL`。
Run: `npm run tauri:dev`
操作步驟並確認：
1. 選語言（English）→ 出現「連線中…」→ 進入對話。
2. 聽到 Kero 用所選語言主動打招呼（`greet`），綠色氣泡出現其字幕。
3. **按住** 🎤 說一句話 → 放開 → 右側出現你的字幕（`user_transcript`）。
4. Kero 語音回覆並串流字幕。
5. 按「結束」→ 連線關閉、出現「重新開始」。

若第 2/3 步無反應：開 Safari 開發者主控台看 data channel 事件名稱是否與 `parseRealtimeEvent` 對應；若 OpenAI 回 4xx，檢查 `mintSession`/`connectRealtime` 的請求形狀（見檔頭核實提醒），只需改那兩個函式。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove mock STT/TTS path now replaced by Realtime API"
```

---

## Self-Review 對照

- **WKWebView STT 死路** → Task 1–2（server 鑄造）+ Task 5（WebRTC 取代 webkitSpeechRecognition）✅
- **ephemeral key 安全模型** → Task 1（mint）、Task 4（前端只拿短命 key）✅
- **Express dev/prod 共用、單一 `getRealtimeSession` 接縫** → Task 3（concurrently）、Task 4（`VITE_SESSION_URL`）✅
- **WebRTC + push-to-talk** → Task 5（`startTalking`/`stopTalking`）、Task 7（`onPointerDown/Up`）✅
- **cedar / gpt-4o-transcribe / turn_detection:null** → Task 1（`buildSessionBody`）✅
- **狀態機重構 selectingLanguage→connecting→live→ended/error** → Task 6 ✅
- **字幕（user + kero 串流）** → Task 5（`parseRealtimeEvent`）、Task 7（`keroInterim` + messages）✅
- **淘汰 webkitSpeechRecognition / SpeechSynthesis / mockRespond / DEBUG** → Task 7 改寫 + Task 8 清理 ✅
- **錯誤處理（麥克風拒絕 / 鑄造失敗 / 連線失敗 / 結束）** → Task 7（catch → ERROR）、Task 6（error/ended 狀態）✅
- **測試（server /session、chatMachine、event parser）** → Task 1/2/4/5/6；WebRTC 實連為 Task 8 手動驗收 ✅
- **環境設定（server/.env、VITE_SESSION_URL、CSP null）** → Task 1/3 ✅

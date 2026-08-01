# Realtime 語音對話（OpenAI Realtime API）設計

日期：2026-08-01
分支：feature/chatboard-ui
狀態：草稿，待 review

## 背景與問題

Kero 對話練習的語音輸入原本用 **Web Speech API**（`webkitSpeechRecognition`）。已確診在 **Tauri 桌面 App（macOS WKWebView）** 中無法運作：

- 現象：麥克風權限正常、進入 listening（紅框），但講話後 `onresult` 從不觸發。
- 根因（已驗證）：按下麥克風後 `onerror` 回傳 **`service-not-allowed`**。WKWebView 只暴露 `webkitSpeechRecognition` 建構子，背後沒有可用引擎；Apple 僅允許 **Safari.app** 使用系統語音辨識服務，第三方 WKWebView 拿不到，且**無 entitlement 可解鎖**。
- 結論：Web Speech API STT 在 Tauri 是死路，需換架構。`getUserMedia`（錄音）本身可用，缺的是「音訊 → 文字/對話」這段。

## 目標

用 **OpenAI Realtime API**（`gpt-realtime`，語音對語音）取代原本 STT + mockRespond + TTS 的整條對話迴圈，提供更貼近語言學習的即時語音對話體驗。

## 非目標（YAGNI）

- 不做多模型／多供應商抽象。
- 不做離線模式。
- 本 spec 不做 server 的部署與驗證/限流（Phase 2）；只在本機跑 Express 供開發串接。

## 安全模型：ephemeral key

真正的 `OPENAI_API_KEY` 絕不能進前端 bundle。流程：

```
[前端 JS]  --getRealtimeSession()-->  [可信後端]
                                        │ 讀 OPENAI_API_KEY
                                        │ POST /v1/realtime/client_secrets
                                        ▼
[前端 JS]  <-- ephemeral client_secret (~1 分鐘有效) --
   │
   └-- getUserMedia + RTCPeerConnection，用 ephemeral key 直連 OpenAI Realtime
```

前端只拿短命 ephemeral key；真 key 只活在可信後端。

## 鑄造端：獨立 Express server（dev/prod 共用）

最終需公開發佈給使用者，真 key 不可落在使用者電腦上，故鑄造 ephemeral key 的可信後端必須是**一台你自己掌控的獨立服務**。決定採 **Express（Node/TypeScript）server**，dev 與 prod 用**同一份程式**，避免寫發佈時會作廢的 Tauri Rust command。

理由：終點一定是遠端服務；一次寫好、dev/prod 一致、前端永遠 `fetch` 同一介面、零重工，發佈時只需補上驗證/限流。代價僅為開發時多跑一個本地 Node 程序（掛進 npm script）。

| | Phase 1（現在・開發） | Phase 2（發佈前） |
|---|---|---|
| 鑄造端 | 本機跑同一支 Express（`localhost`） | **同一支 Express** 部署到主機（Render / Railway / Fly / VPS） |
| 前端如何取得 session | `getRealtimeSession()` → `fetch(SESSION_URL)` | 同左，只換 `SESSION_URL` base |
| 真 key 位置 | 開發者電腦 `.env`（server 讀） | 主機環境變數 |
| 額外工作 | 無 | 部署 + 驗證/限流（防盜刷帳單） |

前端把「取得 session」收斂成單一 `getRealtimeSession()` 接縫；`SESSION_URL` 由環境變數（Vite `VITE_SESSION_URL`）決定，dev 指向 `localhost`、prod 指向部署網址。**本 spec 實作 Phase 1（本機 Express + 前端串接）**；Phase 2 的部署與驗證/限流列為後續。

## 傳輸選擇：WebRTC（非 WebSocket）

WebRTC 在 WebView 內原生處理麥克風擷取、回音消除、遠端音訊播放；WebSocket 需手動切 PCM16 音框並自行播放，在 WKWebView 內成本高。故採 **WebRTC**，使用瀏覽器原生 `RTCPeerConnection`，前端不需新增套件。

## 架構與元件

### Express server（可信後端，dev/prod 共用）

- 新專案目錄 `server/`（Node + TypeScript，Express）
- 端點：`POST /session`
  - 請求 body：`{ lang: 'en' | 'es' }`
  - 讀 env `OPENAI_API_KEY`（`dotenv` 載入 `.env`）
  - `POST https://api.openai.com/v1/realtime/client_secrets`，帶入：
    - `model: "gpt-realtime"`
    - session 設定：`voice`、`instructions`（角色＋語言，見下）、`input_audio_transcription`（開啟，供使用者字幕）、`turn_detection: server_vad`
  - 回傳 ephemeral `client_secret`（＋ model / 到期時間）給前端
  - 錯誤（無 key / 網路 / OpenAI 非 2xx）回傳明確 4xx/5xx + 錯誤訊息
- CORS：dev 允許 Vite origin（`http://127.0.0.1:5173`）
- 相依：`express`、`dotenv`、`cors`；TypeScript + `tsx`（dev 執行）
- dev 啟動：掛進根 `package.json` script，用 `concurrently` 與 `tauri dev` / `vite` 一起跑（例：`npm run dev` 同時起 server 與前端）
- **Phase 2（後續）**：部署到主機、加上驗證（如簡單共享 token / origin 檢查）與流量限制（`express-rate-limit`）防盜刷

### 前端

- `src/lib/realtime.ts`（新）：
  - `getRealtimeSession(lang)` — `fetch(VITE_SESSION_URL + '/session', { body: { lang } })`（唯一接縫；`VITE_SESSION_URL` dev 指 `localhost`、prod 指部署網址）
  - `connectRealtime(session, { onEvent, remoteAudioEl })` — 建立 `RTCPeerConnection`：加入 `getUserMedia` 麥克風 track、掛遠端音訊 track 到 `<audio>`、開 data channel、做 SDP offer/answer、把 Realtime server 事件轉拋給呼叫端
  - `disconnect()` — 關閉連線與麥克風 track
- `src/machines/chatMachine.ts`（重構）狀態：
  - `selectingLanguage` → `SELECT_LANGUAGE`
  - `connecting`（鑄造 key + WebRTC 協商中）
  - `live`（session 進行中）；context 記錄 `speaker: 'user' | 'kero' | null`，由 Realtime 事件更新
  - `ended`（正常結束）/ `error`（含錯誤訊息）
  - 事件：`START`（連線）、`CONNECTED`、`PTT_DOWN`/`PTT_UP`（按住/放開說話）、`SPEAKER_CHANGE`、`TRANSCRIPT`、`END`、`ERROR`
- `src/ChatboardApp.tsx`（改寫）：
  - 移除 `webkitSpeechRecognition`、`SpeechSynthesisUtterance`、`mockRespond`、`[DEBUG-mic]` 除錯碼
  - 互動模型：按 🎤 先**連線**（connecting→live）；連上後 🎤 變成**按住說話（push-to-talk）**——按住時麥克風 track 啟用、放開時送 `input_audio_buffer.commit` + `response.create` 取得 Kero 回覆；另設「結束對話」鈕 disconnect
  - 依 `speaker` 呈現「誰在說話」的視覺狀態
  - 隱藏的 `<audio autoplay>` 播放 Kero 語音
- 淘汰 `src/lib/mockRespond.ts`（移出對話路徑）

### Realtime session 設定（角色與語言）

- `voice`：`cedar`
- `instructions`：Kero 是友善的青蛙語言對話練習夥伴；以所選語言對話（`en` → English、`es` → Spanish）；對學習者用簡單句、鼓勵、必要時溫和糾正
- `input_audio_transcription`：`gpt-4o-transcribe`（供使用者字幕）
- `turn_detection`：`null`（**按住說話 / push-to-talk**；不用 server VAD，由前端手動控制輪次）

## 資料流（單次對話）

1. 使用者選語言 → 按 🎤 連線 → machine 進 `connecting`
2. `getRealtimeSession(lang)` → 呼叫 Express `/session` 鑄造 ephemeral → 回前端
3. `connectRealtime()`：`getUserMedia` → 加 track（預設不啟用）→ SDP 協商 → 連上 → machine 進 `live`
4. 使用者**按住 🎤 說話** → 放開 → 送 `input_audio_buffer.commit` + `response.create` → 模型回應 → 遠端音訊 track 播放（Kero 說話）
5. data channel 事件更新字幕：
   - 使用者：`conversation.item.input_audio_transcription.completed`
   - Kero：`response.audio_transcript.delta` / `.done`
6. 按結束 或 session 到期 → `disconnect()` → machine 進 `ended`

## 錯誤處理

- **麥克風權限被拒**（`getUserMedia` 失敗）：沿用現有紅字提示，回 `selectingLanguage`/idle。
- **鑄造失敗**（無 API key / 網路 / OpenAI 非 2xx）：machine 進 `error`，顯示訊息，可重試。
- **WebRTC 連線失敗**：進 `error`，可重試。
- **session 到期 / 連線中斷**：進 `ended`，提供重新開始。
- **費用防護**：session 有最長時限；提供明顯的手動「結束對話」；不做自動重連。

## 環境設定

- `server/.env`（`.gitignore`）含 `OPENAI_API_KEY`；新增 `server/.env.example`
- 前端 `.env`：`VITE_SESSION_URL`（dev 預設 `http://127.0.0.1:8787`）
- CSP 目前為 `null`，前端可直連 OpenAI（WebRTC）與本機 Express，無需額外放行
- 根 `package.json`：用 `concurrently` 讓 `npm run dev` 同時啟動 Express server 與 Vite/Tauri

## 測試

- Express `/session`：以 mock/注入 OpenAI base URL 測「無 key → 明確錯誤」、「2xx → 正確解析回傳」、「非 2xx → 錯誤訊息」
- `chatMachine`：沿用現有 xstate 單元測試風格，覆蓋狀態轉移（connecting→live→ended、任一步 → error）
- WebRTC 實連為 human-in-the-loop 手動驗證（跑 `tauri dev`、講話、確認聽到 Kero 回覆、字幕正確）——列為驗收步驟，非自動化

## 開放問題 / 待 review 確認

- ~~`voice`~~ → 已定 `cedar`
- ~~轉錄模型~~ → 已定 `gpt-4o-transcribe`
- ~~麥克風互動~~ → 已定 **按住說話（push-to-talk）**，`turn_detection: null`
- `gpt-realtime` 的實際 API 欄位（`client_secrets` 端點的請求/回應結構、push-to-talk 的 `input_audio_buffer.commit` / `response.create` 事件）需在實作時對照當前官方文件核實。

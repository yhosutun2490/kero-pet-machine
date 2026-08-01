# Chatboard UI Design

**Date:** 2026-07-29
**Feature branch:** `feature/chatboard-ui`

---

## Problem Statement

Kero 目前只支援點擊（休眠/喚醒）和拖曳，缺乏深度互動。使用者沒有辦法跟 Kero 練習口說語言，桌面寵物的陪伴感不足。

## Solution

在 Kero 上加入右鍵選單，選擇「對話練習」後開啟獨立聊天視窗。使用者可選擇英文或西班牙文，Kero 用選定語言先開口，使用者以麥克風語音回應，Web Speech API 將語音轉為文字顯示，mock AI 再以 TTS 語音回應，形成來回對話練習循環。

---

## Architecture Overview

```
右鍵選單 (HTML custom menu)
    └─ 點擊「對話練習」
          └─ Tauri: 開啟新 WebviewWindow (chatboard)
                └─ React chatboard app
                      └─ chatMachine (XState)
                            ├─ Web Speech API (STT：使用者語音 → 文字)
                            └─ Browser TTS (mock：Kero 說話)

keroMachine (主視窗)
    └─ CHAT_OPEN → looking 狀態（Kero 望向聊天視窗）
    └─ CHAT_CLOSE → performing 狀態
    └─ 透過 Tauri event (emit/listen) 與聊天視窗溝通
```

兩個視窗完全獨立運作。`chatMachine` 只管對話流程，不知道 Kero 的存在。主視窗透過 Tauri event 收到開關通知，控制 Kero 的動畫狀態。

---

## chatMachine States

```
[selectingLanguage]
    │ SELECT_LANGUAGE(lang: 'en' | 'es')
    ▼
[speaking]  ← Kero 說開場白（entry action 觸發 TTS）
    │ SPEECH_END
    ▼
[idle]  ◄────────────────────────────────────────┐
    │ TAP_MIC                                     │
    ▼                                             │
[listening]  ← Web Speech API 錄音               │
    │ SPEECH_RESULT(text: string)                 │
    ▼                                             │
[processing]  ← mock AI 選出回應文字             │
    │ RESPONSE_READY(text: string)                │
    ▼                                             │
[speaking]  ← TTS 播放 Kero 回應                 │
    │ SPEECH_END                                  │
    └─────────────────────────────────────────────┘
```

### Context

```ts
interface ChatContext {
  language: 'en' | 'es' | null;
  messages: { role: 'kero' | 'user'; text: string }[];
  currentUtterance: string;
}
```

### Events

| Event | Payload | Triggered by |
|---|---|---|
| `SELECT_LANGUAGE` | `lang: 'en' \| 'es'` | 使用者點擊語言按鈕 |
| `TAP_MIC` | — | 使用者點擊麥克風按鈕 |
| `SPEECH_RESULT` | `text: string` | Web Speech API |
| `RESPONSE_READY` | `text: string` | mock AI function |
| `SPEECH_END` | — | TTS `onend` callback |

---

## keroMachine Changes

最小改動，只加入：

- `CHAT_OPEN` event：`performing` / `resting` → `looking`
- `CHAT_CLOSE` event：`looking` → `performing`
- `looking` 狀態已存在且有完整的 16 方向凝視動畫，不需修改

---

## UI Layout (chatboard window)

```
┌─────────────────────────────────┐
│  🐸 Kero 對話練習               │
│  [English]  [Español]           │  ← selectingLanguage 時顯示
├─────────────────────────────────┤
│  (ScrollArea，撐滿可用高度)      │
│                                 │
│  🐸 Hello! How are you today?   │  ← Kero（左對齊，綠色泡泡）
│                                 │
│        I'm fine, thank you! →   │  ← 使用者（右對齊，白色泡泡）
│                                 │
├─────────────────────────────────┤
│  [🎤]          狀態：聆聽中...  │  ← 底部控制列
└─────────────────────────────────┘
```

- 視窗可自由伸縮，對話記錄區自動撐滿剩餘高度
- 語言選擇後隱藏選擇列，對話記錄從頭捲動
- 麥克風按鈕：`idle` 可點 → `listening` 高亮 → `speaking`/`processing` disabled
- STT 識別中即時顯示文字（使用者泡泡先出現，SPEECH_RESULT 確認後定稿）
- Kero 說話時泡泡有打字動畫（與 TTS 同步）

---

## UI Library

**shadcn/ui + Tailwind CSS**

- 元件直接複製進專案（非 npm 依賴），bundle 精簡
- 使用：`ScrollArea`、`Button`、`Badge`
- 樣式可完全客製化，不與 Tauri 透明視窗衝突

---

## Right-Click Menu

- `onContextMenu` 掛在 `App.tsx` 主容器，`e.preventDefault()` 阻擋瀏覽器預設選單
- 自訂 HTML `<menu>`，絕對定位在滑鼠位置，點擊其他地方自動關閉
- 目前只有一個選項：「對話練習」
- 點擊後：呼叫 Tauri `WebviewWindow` API 開啟聊天視窗 + 送 `CHAT_OPEN` 給 keroMachine
- 聊天視窗的 `onCloseRequested` → emit Tauri event → 主視窗 listen 後送 `CHAT_CLOSE`

---

## Mock AI

`mock AI` 為一個純函式：

```ts
function mockRespond(userText: string, language: 'en' | 'es'): string
```

根據語言回傳預設的練習回應句型（不做任何 API 呼叫）。未來替換成 OpenAI Realtime API / WebRTC 時，只需要替換這一層。

---

## Testing Decisions

測試全部走 `createActor` → `send` → assert 的模式，與現有 `keroMachine.test.ts` 完全一致。

**chatMachine 測試涵蓋：**
- 初始狀態為 `selectingLanguage`
- `SELECT_LANGUAGE` → 進入 `speaking`
- `SPEECH_END` → 進入 `idle`
- `TAP_MIC` → 進入 `listening`
- `SPEECH_RESULT` → 進入 `processing`，context.messages 新增使用者訊息
- `RESPONSE_READY` → 進入 `speaking`，context.messages 新增 Kero 訊息
- `SPEECH_END` → 回到 `idle`，可繼續循環

**keroMachine 測試涵蓋：**
- `CHAT_OPEN` in `performing` → `looking`
- `CHAT_OPEN` in `resting` → `looking`
- `CHAT_CLOSE` in `looking` → `performing`

**不測試：**
- React 元件渲染細節
- Web Speech API / TTS 實際行為（全部 mock）
- Tauri 視窗開關的 OS 行為

---

## Out of Scope

- 真實 AI 後端（OpenAI、Claude API 等）
- WebRTC / Realtime API 串接
- 語音品質評分或錯誤糾正
- 對話記錄儲存/匯出
- 右鍵選單的其他選項（設定、關於等）
- 多個聊天視窗同時開啟

---

## Future Notes

- Mock AI 層設計為可替換的單一函式，接 Realtime API 時影響範圍最小
- `looking` 狀態的凝視方向目前固定，未來可根據聊天視窗的實際螢幕位置計算方向

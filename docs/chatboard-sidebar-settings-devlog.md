# 開發紀錄：Chatboard 側邊欄 + 設定頁

**日期：** 2026-08-01
**分支：** `feature/chatboard-ui-chat-api`
**相關文件：** [`spec`](superpowers/specs/2026-08-01-chatboard-sidebar-settings-design.md)、[`ADR-0001`](adr/0001-shell-owns-connection-state.md)、[`CONTEXT.md`](../CONTEXT.md)

在語言視窗左側加一個側邊欄，可在「語言練習」與「設定」兩個 View 之間切換；設定頁讓學習者挑選 realtime 模型與 Kero 的語音（男/女），並即時套用到對話。

---

## 1. 成果一覽

依相依順序、線性切成四張 tracer-bullet ticket，逐張綠燈後才進下一張：

| Ticket | Commit | 內容 |
|--------|--------|------|
| 01 前置重構 | `79e346f` | `ChatboardApp` 拆成 Shell + `ChatPage`（行為不變）|
| 02 側邊欄 | `4ade8fa` | shadcn sidebar + 兩個 View 導覽，換頁不斷線、錄音中切頁自動結束 |
| 03 設定生效 | `2dd0132` | `useSettings`、男/女 voice 挑選、儲存鈕、server 白名單 + 400 |
| 04 即時重連 | `26c9cbf` | `RECONNECT` 事件 + 儲存即時重連（保留 transcript、不 greet）|
| — bug 修復 | `79dda2b` | WebRTC 用 session 的 model 連線，不再寫死 |

測試從 59 → 75（+16）。每張 ticket 都保持 root/server typecheck + `npm run build` 乾淨。

---

## 2. 核心架構決策

### 2.1 Shell 持有連線狀態，View 是可丟棄的純顯示層（ADR-0001）

**問題：** 側邊欄用條件渲染切換 View，切走的 View 會 unmount。若把連線邏輯（machine、WebRTC、audio）放在 `ChatPage` 裡，切到設定頁再切回來就會**斷掉正在進行的對話**。

**解法：** 所有耐久狀態上移到 Shell（`ChatboardApp`）：
- `chatMachine`（`snapshot`/`send`）
- `connRef`（WebRTC）、`<audio>` 元素、push-to-talk handlers
- `settings`、`activeView`

`ChatPage` / `SettingsPage` 只吃 props、發事件，unmount 它們不會動到任何連線。這是「切頁不斷線」成立的**唯一前提**，也是 ticket 01（純重構）存在的理由——先把邊界立好，再加側邊欄。

**驗證方式：** 換頁不斷線是**結構性保證**而非靠測試——teardown effect 只看 machine 的 `isLive`，不看 `activeView`，所以切 View 不可能觸發拆連線。

### 2.2 導覽是 View 不是 Page（無路由）

視窗沒有網址列、沒有 history 需求，所以不裝 `react-router`。glossary 特意把用語定為 **View（分頁）** 而非 **Page**，避免未來讀者誤以為有 URL / 上一頁行為。

---

## 3. 拷問（grilling）釘死的細節

用 `/grill-with-docs` 逐一走決策樹，把容易含糊的地方全部釘死：

- **設定生效方式：** 一開始想「改即時重連」，拷問後改成 **草稿 + 儲存按鈕**。理由：切男/女群組、連點試選都只是改草稿，避免「每次變更就 mint 新 session」的重連風暴；`isDirty` 才亮儲存鈕。
- **離開設定頁的未存草稿：** 直接丟棄（草稿 state 住在 `SettingsPage` 內，unmount 就沒了）。語意乾淨：「沒按儲存 = 沒改」。
- **重連時對話畫面：** 保留 transcript（`context.messages` 不清），畫面連續。
- **重連是否再打招呼：** 不 greet。對話中途突然又自我介紹很怪。
- **錄音中切頁：** 自動結束該次發話（等同放開麥克風）。
- **表單不用 react-hook-form：** 只有兩個欄位、值域被白名單限死，選項本身就是驗證。

決策同時寫進 spec、`CONTEXT.md`（glossary）與 `ADR-0001`。

---

## 4. 實作重點與踩到的坑

### 4.1 ⚠️ 最大的坑：WebRTC 連線寫死 model（commit `79dda2b`）

**症狀：** 選 `gpt-realtime-mini`、儲存、開始對話 → 400：
```
Model "gpt-realtime" does not match the realtime token model.
```

**根因：** 這**不是** `gpt-realtime-mini` 不存在（web 查證它是真實 model，有 `-2025-10-06` / `-2025-12-15` 版本）。是 `src/lib/realtime.ts` 的 SDP 呼叫寫死了：
```ts
const REALTIME_MODEL = 'gpt-realtime';
fetch(`${CALLS_URL}?model=${REALTIME_MODEL}`, ...)
```
Server 端用 `gpt-realtime-mini` mint 了 ephemeral token，但 client 連線時 query 仍送 `gpt-realtime` → OpenAI 要求兩者一致，於是拒絕。

**為什麼一直沒發現：** 之前只有單一 `gpt-realtime`，寫死的值剛好永遠正確；多模型才暴露這個隱藏 bug。

**修法：**
1. `connectRealtime` 新增必填 `model` 參數，URL 改 `?model=${encodeURIComponent(opts.model)}`。
2. Shell 每次連線**只讀一次** `settingsRef.current`（存成 `sel`），mint 與 SDP 呼叫都用同一個 `sel` → 保證兩邊 model 永遠一致（避免中途存檔導致 mint／connect model 不同步）。

**教訓：** 一個設定值若要端到端生效，要沿**整條路徑**追它有沒有被別處寫死——這裡它同時出現在「mint session body」與「WebRTC calls query」兩個地方，只改一處就會 model mismatch。

### 4.2 即時重連：`reconnectNonce`

「儲存時即時重連」若只做 `live → connecting`，遇到**在 `connecting` 狀態時存檔**就失效：state 沒變 → React connect effect 的 deps 沒變 → 不會重跑 → 進行中的連線仍用舊設定。

解法是在 `chatMachine.context` 加一個 `reconnectNonce`，`RECONNECT` 每次遞增，Shell 的 connect effect 把它列入 deps。這樣：
- `live → connecting` + nonce++ → effect 重跑
- `connecting`（停在原地）+ nonce++ → effect 一樣重跑，取消進行中的舊 attempt、用新設定重連

nonce 還一魚兩吃：`greet: reconnectNonce === 0` —— 首次連線（nonce 0）才打招呼，重連（nonce > 0）安靜換嗓。`RESTART` 會 reset context 把 nonce 歸零。

### 4.3 設定變更不該重觸發連線

Shell 用 `settingsRef`（每次 render 同步更新的 ref）在 connect effect 裡讀 settings，**刻意不把 `settings` 放進 effect deps**。否則改設定會讓 effect 重跑、在 live 中意外多連一條。「立即生效」改由明確的 `RECONNECT` 事件驅動，職責清楚。

### 4.4 沒有 DOM 測試環境 → 邏輯抽純函式

專案 vitest 跑在 node env，沒裝 jsdom/happy-dom。為了不引入新依賴，`useSettings` 的解析/驗證邏輯抽到 `src/lib/settings.ts` 的**純函式** `parseSettings` / `serializeSettings` / `genderOf`，在 node 直接測（預設值、壞 JSON、未白名單值、round-trip）；hook 本身只是 localStorage 的薄封裝。

### 4.5 Server 白名單：壞 client 是 400 不是 502

`buildSessionBody` 對未知 model/voice **直接 throw**；`/session` route 先驗證，未知值回 **400**（client 的錯），不是 502（上游的錯）。沒有 silent fallback，壞掉的 client 會被看見。model/voice 都可省略（沿用 pre-settings 預設），只在**有帶但不合法**時才 400。

### 4.6 Push-to-talk：沒講話也回應（tap + 靜音 held）

**症狀：** 點一下麥克風放開、或按住但沒出聲，Kero 也會回話。

**釐清：不是敏感度問題（一開始）。** session 設 `turn_detection: null`，伺服器端 VAD 完全關掉，走純 push-to-talk。所以沒有任何「敏感度門檻」在判斷是否為語音——真正原因是 `stopTalking` **無條件**送 `input_audio_buffer.commit` + `response.create`，每次放開都強迫模型回話，於是它對著靜音也回。

**兩層修法：**
1. **時長門檻**（`MIN_TALK_MS = 300`）：按太短判定誤觸，改送 `input_audio_buffer.clear`、不回應。順帶擋掉 API「commit 不足約 100ms 音訊會報錯」。擋得掉「快速點一下」，擋不掉「按住但沉默」。
2. **音量門檻 / RMS gate**（`SPEECH_RMS_THRESHOLD = 0.015`）：用 Web Audio `AnalyserNode`（無外部依賴）讀原始麥克風，按住期間每 `RMS_SAMPLE_MS = 50ms` 抽樣一次，記住這段的**峰值 RMS**。放開時若峰值低於門檻 → 判定整段是靜音 → 丟棄不回應。這才是真正處理「按住沉默」的槓桿。

**這才是「敏感度」所在：** `SPEECH_RMS_THRESHOLD` 就是可調的敏感度——調高要講比較大聲才觸發（誤觸少、但小聲會被吃掉），調低輕聲也能觸發（但環境噪音容易漏進來）。

**細節：** `AnalyserNode` 接的是原始 `getUserMedia` stream，與 `micTrack.enabled`（只控制 WebRTC 送什麼）無關；但我們只在按住（`enabled = true`）期間抽樣，所以讀到的是真實語音。`AudioContext` 在第一次 `startTalking`（使用者手勢）時 `resume()`，`disconnect` 時 `close()` 並清掉 interval。

### 4.7 其他小坑

- **`.scratch/` 被 gitignore：** ticket 檔案（`.scratch/chatboard-sidebar-settings/issues/`）不進版控，與專案既有 ticket 慣例一致。設計文件（spec/ADR/glossary）才進 git。
- **shadcn sidebar 能對上 base-nova registry：** `npx shadcn@latest add sidebar --yes` 一次帶入 7 個檔（sidebar/sheet/tooltip/separator/skeleton/input + `use-mobile`），與 `@base-ui/react` 無衝突，不需退回手刻 `<aside>`。CSS 變數（`--sidebar-*`）在 `styles.css` 已存在。用 `collapsible="none"` 做小視窗的靜態側邊欄，寬度以 `--sidebar-width: 11rem` 覆寫。
- **Bash 工作目錄會保留：** 某次 `cd server` 後下一個 `git add` 因相對路徑找不到檔而失敗——記得用絕對路徑或 `git -C`。

---

## 5. 未完成 / 待人工驗證

以下只做了單元 + 型別 + build 驗證，**未實跑麥克風做 live 端到端**（需要 OpenAI 金鑰）：

1. 選女聲 → 儲存 → 開始對話，Kero 真的用女聲。
2. 對話中途換聲 → 儲存 → 不離開練習頁、聲音就換、對話氣泡還在。
3. `gpt-realtime-mini` 修完 model mismatch 後能否連上（若出現**別的**錯，如 voice/transcription 不支援，依 spec 退場方案：只留 `gpt-realtime`）。

---

## 6. 檔案地圖

| 檔案 | 角色 |
|------|------|
| `src/ChatboardApp.tsx` | Shell：machine、連線、audio、PTT、settings、activeView |
| `src/components/ChatPage.tsx` | Practice View（純顯示）|
| `src/components/SettingsPage.tsx` | Settings View：model radio + 男/女 voice + 儲存鈕 |
| `src/components/AppSidebar.tsx` | 兩項靜態導覽 |
| `src/hooks/useSettings.ts` | localStorage 薄封裝 |
| `src/lib/settings.ts` | 白名單常數 + 純解析/驗證邏輯 |
| `src/lib/realtime.ts` | `getRealtimeSession(lang, {model,voice})`、`connectRealtime({model, ...})` |
| `src/machines/chatMachine.ts` | `RECONNECT` 事件 + `reconnectNonce` |
| `server/src/session.ts` | `buildSessionBody(lang, {model,voice})` + 白名單 |
| `server/src/app.ts` | `/session` 驗證 model/voice、400 |

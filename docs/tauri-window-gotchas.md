# Tauri 視窗開發注意事項

## 1. 小視窗內的 UI 會被裁切

Kero 的主視窗是 96×104px 的透明、無邊框視窗。Tauri 的 WebView 內容嚴格被裁切在視窗邊界內，**任何 HTML 元素都無法溢出到視窗外面**。

### 症狀

在 96×104px 的視窗內用 `position: fixed` 渲染的選單（`<ul>`、dropdown、tooltip 等），因為比視窗大，超出邊界的部分完全不可見。

### 解法：使用 Tauri 原生 Menu API

Tauri 的 `@tauri-apps/api/menu` 在 OS 層級渲染，不受 WebView 邊界限制：

```ts
import { Menu, MenuItem } from '@tauri-apps/api/menu';

const menu = await Menu.new({
  items: [
    await MenuItem.new({ id: 'my-item', text: '選項名稱', action: handleClick }),
  ],
});
await menu.popup(); // 在目前滑鼠位置顯示原生選單
```

`core:menu:default` 已包含在 `core:default` 中，**不需要額外的 capability 設定**。

---

## 2. 動態建立新視窗需要明確的 Capability 權限

Tauri v2 的權限系統預設禁止所有命令。`core:webview:default`（以及 `core:default`）**不包含** `allow-create-webview-window`。

### 症狀

呼叫 `new WebviewWindow(...)` 後沒有任何反應，也沒有 console 錯誤（async 呼叫的 rejection 被靜默吞掉）。

### 解法：在 `capabilities/` 中明確加入權限

```json
// src-tauri/capabilities/default.json
{
  "windows": ["main", "chatboard"],
  "permissions": [
    "core:webview:allow-create-webview-window",
    "core:window:allow-set-focus"
  ]
}
```

| 權限 | 用途 |
|---|---|
| `core:webview:allow-create-webview-window` | `new WebviewWindow(label, options)` |
| `core:window:allow-set-focus` | `window.setFocus()` — 重新聚焦已開啟的視窗 |

### 新視窗也需要在 `windows` 列表中

`capabilities/default.json` 的 `"windows"` 陣列指定哪些視窗可以使用這份 capability。動態建立的視窗（例如 `"chatboard"`）也必須加入，否則該視窗無法使用任何 Tauri 命令（包含 `emit`）。

```json
"windows": ["main", "chatboard"]
```

---

## 3. macOS 麥克風權限：需要 Info.plist + getUserMedia

### 症狀

點擊麥克風按鈕後沒有出現 macOS 系統授權對話框，或 Web Speech API 直接回傳 `not-allowed` 錯誤。

### 原因

macOS 要求 app 的 `Info.plist` 必須包含 `NSMicrophoneUsageDescription` 才會顯示系統授權對話框。沒有這個 key，系統會靜默拒絕麥克風請求，不顯示任何提示。

### 解法 1：建立 `src-tauri/Info.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>Kero 需要麥克風來進行對話練習。</string>
</dict>
</plist>
```

`tauri.conf.json` 用檔案路徑字串指向它（**不是** inline 物件）：

```json
"bundle": {
  "macOS": {
    "infoPlist": "Info.plist"
  }
}
```

> ⚠️ `infoPlist` 型別是 `string | null`，填入 JSON 物件會導致 build 錯誤：
> `"... is not of types 'null', 'string'"`

### 解法 2：用 `getUserMedia` 主動觸發 OS 對話框

Web Speech API 在 WKWebView（macOS Tauri WebView）裡不一定能可靠觸發系統權限提示。改用 `navigator.mediaDevices.getUserMedia` 更穩定：

```ts
const handleMicClick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 權限已取得 — 立刻停止 stream，讓 Speech Recognition 自行開麥克風
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    setMicError(
      '無法存取麥克風。請前往「系統設定 → 隱私權與安全性 → 麥克風」，允許 Kero 使用麥克風。'
    );
    return;
  }
  startRecognition();
};
```

兩個解法必須同時使用：`NSMicrophoneUsageDescription` 讓 macOS 允許彈出授權對話框，`getUserMedia` 則是實際觸發它的呼叫。

---

## 4. 確認可用權限名稱的方法

Tauri v2 的所有有效 permission identifier 都列在：

```
src-tauri/gen/schemas/desktop-schema.json
```

可以用 grep 快速查詢：

```bash
grep -o '"const": "core:[^"]*"' src-tauri/gen/schemas/desktop-schema.json | sort -u
```

---

## 相關檔案

- `src-tauri/capabilities/default.json` — 應用程式的 capability 設定
- `src-tauri/Info.plist` — macOS 系統權限說明（NSMicrophoneUsageDescription 等）
- `src/hooks/useKeroPet.ts` — Tauri API 整合（視窗、拖曳、選單）
- `src/ChatboardApp.tsx` — 麥克風權限請求與 Web Speech API 整合
- `docs/animation-sync.md` — 拖曳與位置同步的實作細節

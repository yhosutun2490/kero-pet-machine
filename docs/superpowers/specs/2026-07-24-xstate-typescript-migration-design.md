# XState + TypeScript 遷移設計

## 背景與目標

目前 `src/App.jsx` 混合了三件事：畫面渲染、Tauri 視窗連線/同步、rAF tick 迴圈驅動的動畫。動畫與行為邏輯集中在 `src/keroMachine.js` 裡的一個手寫 `keroReducer`，模式切換（performing / resting / looking）用 if/else 字串比對表達，未來要加互動（如 pointer 懸浮進入 looking、拖曳）時不容易看出合法的狀態轉換。

本次遷移要達成三件事：
1. 把 `keroReducer` 改寫成 XState 狀態機，讓 performing/resting/looking 的轉換關係顯式化。
2. 把 App.jsx 中「連線 Tauri、驅動 tick、同步視窗位置」等邏輯抽出成一個自訂 hook，讓 `App.tsx` 只保留渲染。
3. 全專案轉換成 TypeScript，測試框架改用 Vitest。

## 檔案結構

```
src/
  App.tsx                      # 純渲染層，呼叫 useKeroPet() 取得 spriteStyle / onTap
  main.tsx
  hooks/
    useKeroPet.ts              # XState machine 掛載、Tauri 視窗連線、rAF tick loop、視窗位置同步
  machines/
    keroMachine.ts             # XState 狀態機、selectSpriteFrame、CELL_WIDTH 等常數與型別
    keroMachine.test.ts        # 原本的行為測試，改寫成 vitest
tsconfig.json                  # 新增：strict + jsx: react-jsx + moduleResolution bundler
vite.config.ts                 # 從 .js 改名，內容不變
index.html                     # <script src="/src/main.jsx"> 改成 /src/main.tsx
package.json                   # test script 改用 vitest；新增 typecheck script
```

新增依賴：
- dependencies: `xstate`, `@xstate/react`
- devDependencies: `typescript`, `@types/react`, `@types/react-dom`, `vitest`

## 狀態機設計（src/machines/keroMachine.ts）

沿用現有 context 欄位（不改變語意）：

```ts
interface KeroContext {
  facing: 'left' | 'right';
  position: { x: number; y: number };
  velocityX: number;
  bounds: { width: number; height: number };
  actionIndex: number;
  actionElapsedMs: number;
  frame: number;
  frameElapsedMs: number;
  pointer: { x: number; y: number } | null;
  lastPointerAt: number;
  nowMs: number;
}

type KeroEvent =
  | { type: 'BOUNDS'; bounds: { width: number; height: number } }
  | { type: 'POINTER'; pointer: { x: number; y: number } }
  | { type: 'DRAG_START' }
  | { type: 'DRAG_END' }
  | { type: 'TAP' }
  | { type: 'TICK'; dt: number };
```

機器結構：

```ts
createMachine({
  id: 'kero',
  context: createInitialKeroContext,
  on: {
    BOUNDS: { actions: 'applyBounds' },
  },
  initial: 'performing',
  states: {
    performing: {
      entry: 'resetPerformance',
      on: {
        TAP: { target: 'resting' },
        TICK: { actions: 'advanceActionFrame' },
      },
    },
    resting: {
      entry: 'settleAtBottom',
      on: {
        TAP: { target: 'performing' },
        TICK: { actions: 'advanceIdleFrame' },
      },
    },
    looking: {
      // 保留給未來 pointer/drag 互動使用；目前沒有任何轉換會進入這個狀態
      on: { TICK: { actions: 'advanceIdleFrame' } },
    },
  },
})
```

行為對應原本 `keroReducer` 的規則：
- `applyBounds`：對應原 `case 'bounds'`，更新 bounds 並 `pinToBottom`。
- `resetPerformance`（performing.entry）：對應 `toggleResting` 的 else 分支，重置 actionIndex/actionElapsedMs/frame/frameElapsedMs/velocityX。
- `settleAtBottom`（resting.entry）：對應 `toggleResting` 的 if 分支，貼齊底部、清空 pointer、reset frame。
- `advanceActionFrame` / `advanceIdleFrame`：對應 `advanceActionFrame` / `advanceFrame` 的 idle 分支，並在每次 TICK 都重新 `pinToBottom` 與累加 `nowMs`（等同原本 `stepKero`）。
- `POINTER` / `DRAG_START` / `DRAG_END`：不定義 handler，XState 對未宣告事件預設忽略，行為等同現在的 no-op。`looking` state 節點先建立好，未來要讓 pointer hover 進入 looking 時只需加一條 transition，不必重新設計狀態圖。

`selectSpriteFrame(snapshot)` 改吃 `StateFrom<typeof keroMachine>`（讀 `snapshot.value` 與 `snapshot.context`），邏輯與現在相同，只是資料來源從 `state.mode` 換成 `snapshot.value`。

`directionToSpriteCell`、`CELL_WIDTH`、`CELL_HEIGHT`、`PET_SCALE`、`PET_WINDOW_WIDTH`、`PET_WINDOW_HEIGHT` 等純函式/常數原封不動搬到 `keroMachine.ts`。

## Hook 設計（src/hooks/useKeroPet.ts）

把 `App.jsx` 目前的三個 `useEffect`（Tauri 連線、rAF tick、視窗位置同步）與 `useMachine` 掛載整合進這個 hook，回傳畫面需要的最小介面：

```ts
function useKeroPet() {
  // useMachine(keroMachine, { input: ... })
  // useEffect: 連線 Tauri window/webview，取得 monitor bounds 後 send({ type: 'BOUNDS', ... })
  // useEffect: requestAnimationFrame 迴圈，逐 frame send({ type: 'TICK', dt })
  // useEffect: state.context.position 變化時同步 Tauri window setPosition
  return {
    spriteStyle: CSSProperties,
    onTap: () => void,
  };
}
```

`App.tsx` 因此只剩：

```tsx
export default function App() {
  const { spriteStyle, onTap } = useKeroPet();
  return (
    <main className="pet-stage" onClick={onTap} style={{ width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT }}>
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
```

## 測試遷移

`src/keroMachine.test.mjs` → `src/machines/keroMachine.test.ts`，改用 vitest（`describe`/`it`/`expect`，語意與現有 `node:test` + `assert` 一一對應）。呼叫方式從 `keroReducer(state, event)` 改成：

```ts
const actor = createActor(keroMachine, { input }).start();
actor.send(event);
const snapshot = actor.getSnapshot();
```

所有既有斷言（mode/position/velocityX/frame 等）保持相同語意，只是讀取路徑從 `next.mode` 換成 `snapshot.value`，`next.position` 換成 `snapshot.context.position`。

`package.json`：
- `"test": "vitest run"`
- 新增 `"typecheck": "tsc --noEmit"`

## TypeScript 設定

- 新增 `tsconfig.json`：`strict: true`、`jsx: "react-jsx"`、`moduleResolution: "bundler"`、`target: "ES2022"`。
- `vite.config.js` → `vite.config.ts`（內容不變，Vite 原生支援）。
- `index.html` 的 `<script src="/src/main.jsx">` 改成 `/src/main.tsx`。
- `src-tauri` 相關 Rust 程式碼不受影響。

## 範圍界定（Out of scope）

- 不新增 pointer hover / 拖曳等新互動行為本身，只確保 `looking` 狀態節點存在、未來好接。
- 不改變視覺/動畫參數（frame 數、時長、sprite row/column 對應）。
- 不改變 Tauri 視窗定位邏輯的行為，只搬動程式碼位置。

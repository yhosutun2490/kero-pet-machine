# XState + TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate keroMachine.js to an XState v5 state machine in TypeScript, extract App.jsx side-effects into a `useKeroPet` hook, add global cursor-tracking that moves the pet left/right in `performing` state, and switch tests to Vitest.

**Architecture:** `keroMachine.ts` defines the XState machine and all pure logic; `useKeroPet.ts` mounts the machine and handles Tauri side-effects (bounds, position sync, cursor polling via three small focused hooks); `App.tsx` is pure render. Tests use `createActor` / `send` / `getSnapshot`.

**Tech Stack:** XState 5, @xstate/react 4, TypeScript 5 (strict), Vitest 2, React 19, Tauri 2 API

---

### Task 1: Toolchain setup

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`

- [ ] **Step 1: Install new dependencies**

```bash
npm install xstate@^5 @xstate/react@^4
npm install -D typescript@^5 @types/react@^19 @types/react-dom@^19 vitest@^2
```

Expected: exit 0, packages appear in `node_modules/xstate`, `node_modules/vitest`.

- [ ] **Step 2: Overwrite package.json**

```json
{
  "name": "kero-desktop-pet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "dev:tauri": "tauri dev",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@xstate/react": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "xstate": "^5.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^7.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts
git commit -m "chore: add TypeScript, XState v5, Vitest toolchain"
```

---

### Task 2: keroMachine.ts skeleton — types, constants, pure helpers

**Files:**
- Create: `src/machines/keroMachine.ts`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/machines src/hooks
```

- [ ] **Step 2: Create src/machines/keroMachine.ts**

```ts
export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const PET_SCALE = 0.5;
export const PET_WINDOW_WIDTH = CELL_WIDTH * PET_SCALE;
export const PET_WINDOW_HEIGHT = CELL_HEIGHT * PET_SCALE;

const IDLE_FRAME_MS = 160;
const VELOCITY_SCALE = 60;
const MAX_SPEED = 300;

const ACTIONS = [
  { id: 'idle',    row: 0, frames: 6, frameMs: IDLE_FRAME_MS, durationMs: 4000 },
  { id: 'waving',  row: 3, frames: 4, frameMs: 140,           durationMs: 2200 },
  { id: 'jumping', row: 4, frames: 5, frameMs: 140,           durationMs: 2600 },
  { id: 'review',  row: 8, frames: 6, frameMs: 150,           durationMs: 3000 },
] as const;

const LOOK_LABELS = [
  '000', '022.5', '045', '067.5', '090', '112.5', '135', '157.5',
  '180', '202.5', '225', '247.5', '270', '292.5', '315', '337.5',
] as const;

export interface KeroContext {
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

export type KeroEvent =
  | { type: 'BOUNDS'; bounds: { width: number; height: number } }
  | { type: 'POINTER'; dx: number }
  | { type: 'DRAG_START' }
  | { type: 'DRAG_END' }
  | { type: 'TAP' }
  | { type: 'TICK'; dt: number };

export interface KeroInput {
  bounds?: { width: number; height: number };
  position?: { x: number; y: number };
}

export interface KeroSpriteFrame {
  row: number;
  column: number;
  label?: string;
}

function bottomY(bounds: { width: number; height: number }): number {
  return Math.max(0, bounds.height - PET_WINDOW_HEIGHT);
}

function clampX(x: number, bounds: { width: number; height: number }): number {
  return Math.max(0, Math.min(x, bounds.width - PET_WINDOW_WIDTH));
}

function clampPosition(
  position: { x: number; y: number },
  bounds: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: clampX(position.x, bounds),
    y: Math.max(0, Math.min(position.y, bounds.height - PET_WINDOW_HEIGHT)),
  };
}

function pinToBottom(
  position: { x: number; y: number },
  bounds: { width: number; height: number },
): { x: number; y: number } {
  return { ...clampPosition(position, bounds), y: bottomY(bounds) };
}

function pointerDegrees(pointer: { x: number; y: number }): number {
  const center = { x: PET_WINDOW_WIDTH / 2, y: PET_WINDOW_HEIGHT / 2 };
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export function directionToSpriteCell(degrees: number): KeroSpriteFrame {
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  const row = index < 8 ? 9 : 10;
  const column = index < 8 ? index : index - 8;
  return { row, column, label: LOOK_LABELS[index] };
}

export function createInitialKeroContext(input?: KeroInput): KeroContext {
  const bounds = input?.bounds ?? { width: 900, height: 600 };
  const position = input?.position ?? { x: 120, y: bottomY(bounds) };
  return {
    facing: 'right',
    position,
    velocityX: 0,
    bounds,
    actionIndex: 0,
    actionElapsedMs: 0,
    frame: 0,
    frameElapsedMs: 0,
    pointer: null,
    lastPointerAt: 0,
    nowMs: 0,
  };
}

// Interim snapshot type — replaced with StateFrom<typeof keroMachine> in Task 4
interface KeroSnapshot {
  value: string;
  context: KeroContext;
}

export function selectSpriteFrame(snapshot: KeroSnapshot): KeroSpriteFrame {
  const { value, context } = snapshot;
  if (value === 'looking' && context.pointer) {
    return directionToSpriteCell(pointerDegrees(context.pointer));
  }
  if (value === 'resting') {
    return { row: 5, column: 4 };
  }
  if (value === 'performing') {
    const action = ACTIONS[context.actionIndex % ACTIONS.length];
    return { row: action.row, column: context.frame % action.frames };
  }
  return { row: 0, column: context.frame % 6 };
}
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/machines/keroMachine.ts
git commit -m "feat: add keroMachine.ts types, constants, and pure helpers"
```

---

### Task 3: keroMachine.test.ts — write all tests (TDD red phase)

**Files:**
- Create: `src/machines/keroMachine.test.ts`

- [ ] **Step 1: Create src/machines/keroMachine.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  CELL_WIDTH, CELL_HEIGHT, PET_SCALE, PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT,
  directionToSpriteCell, selectSpriteFrame,
  keroMachine,  // does not exist yet — tests will fail
} from './keroMachine';

describe('constants', () => {
  it('desktop window renders Kero at half-size', () => {
    expect(PET_SCALE).toBe(0.5);
    expect(PET_WINDOW_WIDTH).toBe(CELL_WIDTH * PET_SCALE);
    expect(PET_WINDOW_HEIGHT).toBe(CELL_HEIGHT * PET_SCALE);
  });
});

describe('initial state', () => {
  it('starts in performing, pinned to bottom, action row 0', () => {
    const actor = createActor(keroMachine, { input: { bounds: { width: 500, height: 400 } } }).start();
    const s = actor.getSnapshot();
    expect(s.value).toBe('performing');
    expect(s.context.position.y).toBe(296); // 400 - 104 = 296
    expect(s.context.velocityX).toBe(0);
    expect(selectSpriteFrame(s).row).toBe(0);
  });
});

describe('TICK', () => {
  it('advances animation without moving when velocityX is 0', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 500, height: 400 }, position: { x: 120, y: 296 } },
    }).start();
    actor.send({ type: 'TICK', dt: 1 });
    const s = actor.getSnapshot();
    expect(s.context.position.x).toBe(120);
    expect(s.context.position.y).toBe(296);
    expect(s.context.velocityX).toBe(0);
    expect(selectSpriteFrame(s).row).toBe(0);
  });

  it('applies velocityX to position.x and resets it to 0', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'POINTER', dx: 3 }); // velocityX = clamp(3*60, -300, 300) = 180 px/s
    actor.send({ type: 'TICK', dt: 1 / 60 }); // dt = 1 frame
    const s = actor.getSnapshot();
    // 100 + 180 * (1/60) = 103
    expect(s.context.position.x).toBeCloseTo(103);
    expect(s.context.velocityX).toBe(0);
    expect(s.context.facing).toBe('right');
  });

  it('advances animation frame with elapsed time', () => {
    const actor = createActor(keroMachine, { input: {} }).start();
    actor.send({ type: 'TICK', dt: 0.17 }); // 170ms > IDLE_FRAME_MS(160) → 1 step
    expect(actor.getSnapshot().context.frame).toBe(1);
  });

  it('cycles through action rows over time', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 900, height: 600 }, position: { x: 240, y: 496 } },
    }).start();
    actor.send({ type: 'TICK', dt: 4.1 }); // 4100ms: idle(4000) → waving(row 3)
    const s = actor.getSnapshot();
    expect(s.context.position.x).toBe(240);
    expect(selectSpriteFrame(s).row).toBe(3);
  });
});

describe('BOUNDS', () => {
  it('keeps Kero pinned to the new bottom', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 500, height: 400 }, position: { x: 120, y: 80 } },
    }).start();
    actor.send({ type: 'BOUNDS', bounds: { width: 700, height: 600 } });
    const s = actor.getSnapshot();
    expect(s.context.position.x).toBe(120);
    expect(s.context.position.y).toBe(496); // 600 - 104 = 496
  });
});

describe('POINTER', () => {
  it('dx > 0 in performing sets velocityX and facing right', () => {
    const actor = createActor(keroMachine, { input: {} }).start();
    actor.send({ type: 'POINTER', dx: 2 });
    const s = actor.getSnapshot();
    expect(s.context.velocityX).toBe(120); // 2 * 60 = 120
    expect(s.context.facing).toBe('right');
  });

  it('dx < 0 in performing sets velocityX and facing left', () => {
    const actor = createActor(keroMachine, { input: {} }).start();
    actor.send({ type: 'POINTER', dx: -2 });
    const s = actor.getSnapshot();
    expect(s.context.velocityX).toBe(-120);
    expect(s.context.facing).toBe('left');
  });

  it('dx = 0 does not change facing', () => {
    const actor = createActor(keroMachine, { input: {} }).start();
    actor.send({ type: 'POINTER', dx: 2 }); // facing = right
    actor.send({ type: 'POINTER', dx: 0 }); // should not change facing
    const s = actor.getSnapshot();
    expect(s.context.facing).toBe('right');
    expect(s.context.velocityX).toBe(0);
  });

  it('dx is capped at MAX_SPEED (300 px/s)', () => {
    const actor = createActor(keroMachine, { input: {} }).start();
    actor.send({ type: 'POINTER', dx: 100 }); // 100*60=6000, capped at 300
    expect(actor.getSnapshot().context.velocityX).toBe(300);
  });

  it('is ignored in resting state', () => {
    const actor = createActor(keroMachine, { input: { bounds: { width: 800, height: 600 } } }).start();
    actor.send({ type: 'TAP' }); // → resting
    actor.send({ type: 'POINTER', dx: 10 });
    const s = actor.getSnapshot();
    expect(s.value).toBe('resting');
    expect(s.context.velocityX).toBe(0);
    expect(s.context.facing).toBe('right');
  });
});

describe('TAP', () => {
  it('makes Kero rest at the bottom of the screen', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 240, y: 100 } },
    }).start();
    actor.send({ type: 'TAP' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('resting');
    expect(s.context.position.y).toBe(496);
    expect(s.context.velocityX).toBe(0);
    expect(selectSpriteFrame(s)).toEqual({ row: 5, column: 4 });
  });

  it('wakes Kero from resting and resumes actions', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 240, y: 496 } },
    }).start();
    actor.send({ type: 'TAP' }); // → resting
    actor.send({ type: 'TAP' }); // → performing
    const s = actor.getSnapshot();
    expect(s.value).toBe('performing');
    expect(s.context.velocityX).toBe(0);
    expect(selectSpriteFrame(s).row).toBe(0);
  });
});

describe('DRAG_START / DRAG_END', () => {
  it('DRAG_START does not change state in performing', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'TICK', dt: 1 });
    const s = actor.getSnapshot();
    expect(s.value).toBe('performing');
    expect(s.context.position.x).toBe(100);
  });

  it('DRAG_END does not change state in resting', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 240, y: 496 } },
    }).start();
    actor.send({ type: 'TAP' }); // → resting
    actor.send({ type: 'DRAG_END' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('resting');
    expect(s.context.velocityX).toBe(0);
  });
});

describe('directionToSpriteCell', () => {
  it('maps pointer angles to look rows and columns', () => {
    expect(directionToSpriteCell(0)).toEqual({ row: 9, column: 0, label: '000' });
    expect(directionToSpriteCell(90)).toEqual({ row: 9, column: 4, label: '090' });
    expect(directionToSpriteCell(180)).toEqual({ row: 10, column: 0, label: '180' });
    expect(directionToSpriteCell(270)).toEqual({ row: 10, column: 4, label: '270' });
    expect(directionToSpriteCell(337)).toEqual({ row: 10, column: 7, label: '337.5' });
  });
});
```

- [ ] **Step 2: Run tests — expect red (keroMachine not exported)**

```bash
npm test
```

Expected: FAIL — `keroMachine` is not exported from `./keroMachine`.

- [ ] **Step 3: Commit (red tests are intentional in TDD)**

```bash
git add src/machines/keroMachine.test.ts
git commit -m "test: add keroMachine.test.ts (red — machine not implemented yet)"
```

---

### Task 4: Implement keroMachine — green phase

**Files:**
- Modify: `src/machines/keroMachine.ts`

- [ ] **Step 1: Replace KeroSnapshot interim type and selectSpriteFrame, add machine**

Add these imports at the top of `src/machines/keroMachine.ts`:

```ts
import { setup, assign } from 'xstate';
import type { StateFrom } from 'xstate';
```

Replace the `KeroSnapshot` interface and `selectSpriteFrame` at the bottom of the file, then append the machine definition. The full additions after `createInitialKeroContext`:

```ts
// --- Action helpers (pure functions used by assign) ---

function applyBoundsContext(
  context: KeroContext,
  event: Extract<KeroEvent, { type: 'BOUNDS' }>,
): Pick<KeroContext, 'bounds' | 'position'> {
  return {
    bounds: event.bounds,
    position: pinToBottom(context.position, event.bounds),
  };
}

function advanceActionFrameContext(
  context: KeroContext,
  event: Extract<KeroEvent, { type: 'TICK' }>,
): Partial<KeroContext> {
  const elapsedMs = event.dt * 1000;
  let actionIndex = context.actionIndex % ACTIONS.length;
  let actionElapsedMs = context.actionElapsedMs + elapsedMs;

  while (actionElapsedMs >= ACTIONS[actionIndex].durationMs) {
    actionElapsedMs -= ACTIONS[actionIndex].durationMs;
    actionIndex = (actionIndex + 1) % ACTIONS.length;
  }

  const action = ACTIONS[actionIndex];
  const frameElapsed = context.frameElapsedMs + elapsedMs;
  const steps = Math.floor(frameElapsed / action.frameMs);

  return {
    actionIndex,
    actionElapsedMs,
    frame: (context.frame + steps) % action.frames,
    frameElapsedMs: frameElapsed % action.frameMs,
    position: {
      x: clampX(context.position.x + context.velocityX * event.dt, context.bounds),
      y: bottomY(context.bounds),
    },
    velocityX: 0,
    nowMs: context.nowMs + elapsedMs,
  };
}

function advanceIdleFrameContext(
  context: KeroContext,
  event: Extract<KeroEvent, { type: 'TICK' }>,
): Partial<KeroContext> {
  const elapsedMs = event.dt * 1000;
  const elapsed = context.frameElapsedMs + elapsedMs;
  const steps = Math.floor(elapsed / IDLE_FRAME_MS);
  return {
    frame: (context.frame + steps) % 6,
    frameElapsedMs: elapsed % IDLE_FRAME_MS,
    position: { x: context.position.x, y: bottomY(context.bounds) },
    nowMs: context.nowMs + elapsedMs,
  };
}

function applyPointerVelocityContext(
  context: KeroContext,
  event: Extract<KeroEvent, { type: 'POINTER' }>,
): Pick<KeroContext, 'velocityX' | 'facing'> {
  const velocityX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, event.dx * VELOCITY_SCALE));
  return {
    velocityX,
    facing: event.dx > 0 ? 'right' : event.dx < 0 ? 'left' : context.facing,
  };
}

// --- Machine ---

export const keroMachine = setup({
  types: {} as {
    context: KeroContext;
    events: KeroEvent;
    input: KeroInput;
  },
  actions: {
    applyBounds: assign(({ context, event }) =>
      applyBoundsContext(context, event as Extract<KeroEvent, { type: 'BOUNDS' }>),
    ),
    resetPerformance: assign({
      actionIndex: 0,
      actionElapsedMs: 0,
      frame: 0,
      frameElapsedMs: 0,
      velocityX: 0,
    }),
    settleAtBottom: assign(({ context }) => ({
      position: { x: context.position.x, y: bottomY(context.bounds) },
      velocityX: 0 as const,
      pointer: null,
      frame: 0,
      frameElapsedMs: 0,
    })),
    advanceActionFrame: assign(({ context, event }) =>
      advanceActionFrameContext(context, event as Extract<KeroEvent, { type: 'TICK' }>),
    ),
    advanceIdleFrame: assign(({ context, event }) =>
      advanceIdleFrameContext(context, event as Extract<KeroEvent, { type: 'TICK' }>),
    ),
    applyPointerVelocity: assign(({ context, event }) =>
      applyPointerVelocityContext(context, event as Extract<KeroEvent, { type: 'POINTER' }>),
    ),
  },
}).createMachine({
  id: 'kero',
  context: ({ input }) => createInitialKeroContext(input),
  on: {
    BOUNDS: { actions: 'applyBounds' },
  },
  initial: 'performing',
  states: {
    performing: {
      entry: { type: 'resetPerformance' },
      on: {
        TAP:     { target: 'resting' },
        TICK:    { actions: 'advanceActionFrame' },
        POINTER: { actions: 'applyPointerVelocity' },
      },
    },
    resting: {
      entry: { type: 'settleAtBottom' },
      on: {
        TAP:  { target: 'performing' },
        TICK: { actions: 'advanceIdleFrame' },
      },
    },
    looking: {
      on: { TICK: { actions: 'advanceIdleFrame' } },
    },
  },
});

// --- selectSpriteFrame (uses proper type after machine is defined) ---

export function selectSpriteFrame(snapshot: StateFrom<typeof keroMachine>): KeroSpriteFrame {
  const { value, context } = snapshot;
  if (value === 'looking' && context.pointer) {
    return directionToSpriteCell(pointerDegrees(context.pointer));
  }
  if (value === 'resting') {
    return { row: 5, column: 4 };
  }
  if (value === 'performing') {
    const action = ACTIONS[context.actionIndex % ACTIONS.length];
    return { row: action.row, column: context.frame % action.frames };
  }
  return { row: 0, column: context.frame % 6 };
}
```

Note: remove the old `KeroSnapshot` interface and old `selectSpriteFrame` function that were added in Task 2 — they are replaced by the versions above.

- [ ] **Step 2: Run tests — expect green**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/machines/keroMachine.ts
git commit -m "feat: implement XState keroMachine with POINTER movement and TypeScript"
```

---

### Task 5: useKeroPet.ts — hook with sub-hooks

**Files:**
- Create: `src/hooks/useKeroPet.ts`

- [ ] **Step 1: Create src/hooks/useKeroPet.ts**

```ts
import { useEffect, useMemo, useRef } from 'react';
import { useMachine } from '@xstate/react';
import type { CSSProperties } from 'react';
import {
  keroMachine,
  selectSpriteFrame,
  CELL_WIDTH,
  CELL_HEIGHT,
  PET_SCALE,
  PET_WINDOW_WIDTH,
  PET_WINDOW_HEIGHT,
} from '../machines/keroMachine';
import type { KeroEvent } from '../machines/keroMachine';

type Send = (event: KeroEvent) => void;

// Connects to Tauri window/webview, reads monitor bounds, sends BOUNDS event.
function useTauriSetup(send: Send): void {
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (!window.__TAURI_INTERNALS__) return;
      const [{ getCurrentWindow }, { getCurrentWebview }] = await Promise.all([
        import('@tauri-apps/api/window'),
        import('@tauri-apps/api/webview'),
      ]);
      if (cancelled) return;

      const appWindow = getCurrentWindow();
      const webview = getCurrentWebview();
      await Promise.allSettled([
        appWindow.setBackgroundColor([0, 0, 0, 0]),
        webview.setBackgroundColor([0, 0, 0, 0]),
      ]);

      const monitor = await appWindow.currentMonitor();
      const width = monitor?.workArea?.size?.width ?? 900;
      const height = monitor?.workArea?.size?.height ?? 600;
      send({ type: 'BOUNDS', bounds: { width, height } });
    }

    connect();
    return () => { cancelled = true; };
  }, [send]);
}

// rAF loop: sends TICK every frame. Also fire-and-forget polls getCursorPos()
// to send POINTER with dx to the machine.
function useRafTick(send: Send): void {
  const lastTickRef = useRef(performance.now());
  const prevCursorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let frameId = 0;

    function tick(now: number) {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      if (window.__TAURI_INTERNALS__) {
        import('@tauri-apps/api/window').then(({ getCursorPos }) => {
          getCursorPos().then((pos) => {
            const prev = prevCursorRef.current;
            if (prev) {
              const dx = pos.x - prev.x;
              if (dx !== 0) send({ type: 'POINTER', dx });
            }
            prevCursorRef.current = { x: pos.x, y: pos.y };
          });
        });
      }

      send({ type: 'TICK', dt });
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [send]);
}

// Syncs machine position to the Tauri window whenever position changes.
function useTauriPositionSync(position: { x: number; y: number }): void {
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
      getCurrentWindow().setPosition(
        new PhysicalPosition(Math.round(position.x), Math.round(position.y)),
      );
    });
  }, [position.x, position.y]);
}

export function useKeroPet(): {
  spriteStyle: CSSProperties;
  containerStyle: CSSProperties;
  onTap: () => void;
} {
  const [snapshot, send] = useMachine(keroMachine, { input: {} });

  useTauriSetup(send);
  useRafTick(send);
  useTauriPositionSync(snapshot.context.position);

  const spriteFrame = selectSpriteFrame(snapshot);
  const facing = snapshot.context.facing;

  const spriteStyle = useMemo<CSSProperties>(
    () => ({
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
      backgroundImage: 'url("/kerolet-spritesheet.webp")',
      backgroundPosition: `-${spriteFrame.column * CELL_WIDTH}px -${spriteFrame.row * CELL_HEIGHT}px`,
      transform: facing === 'left'
        ? `scale(${PET_SCALE}) scaleX(-1)`
        : `scale(${PET_SCALE})`,
    }),
    [spriteFrame.column, spriteFrame.row, facing],
  );

  const containerStyle = useMemo<CSSProperties>(
    () => ({ width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT }),
    [],
  );

  return {
    spriteStyle,
    containerStyle,
    onTap: () => send({ type: 'TAP' }),
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useKeroPet.ts
git commit -m "feat: add useKeroPet hook with Tauri setup, rAF tick, cursor polling, and position sync"
```

---

### Task 6: App.tsx, main.tsx, index.html

**Files:**
- Create: `src/App.tsx`
- Create: `src/main.tsx`
- Modify: `index.html`

- [ ] **Step 1: Create src/App.tsx**

```tsx
import { useKeroPet } from './hooks/useKeroPet';
import { PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT } from './machines/keroMachine';

export default function App() {
  const { spriteStyle, onTap } = useKeroPet();
  return (
    <main
      className="pet-stage"
      onClick={onTap}
      style={{ width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT }}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
```

- [ ] **Step 2: Create src/main.tsx**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Update index.html — change script src to main.tsx**

In `index.html`, change:
```html
<script type="module" src="/src/main.jsx"></script>
```
to:
```html
<script type="module" src="/src/main.tsx"></script>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/main.tsx index.html
git commit -m "feat: add App.tsx and main.tsx — pure render layer using useKeroPet"
```

---

### Task 7: Delete old files and final verification

**Files:**
- Delete: `src/keroMachine.js`
- Delete: `src/keroMachine.test.mjs`
- Delete: `src/App.jsx`
- Delete: `src/main.jsx`
- Delete: `vite.config.js`

- [ ] **Step 1: Delete old files**

```bash
git rm src/keroMachine.js src/keroMachine.test.mjs src/App.jsx src/main.jsx vite.config.js
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove legacy JS files after TypeScript migration"
```

---

## Self-review checklist

| Spec requirement | Task |
|---|---|
| keroReducer → XState machine (performing/resting/looking) | Task 4 |
| App.jsx logic → useKeroPet hook | Task 5 |
| Full TypeScript (strict) | Task 1, 2, 4, 5, 6 |
| Tests → Vitest, createActor pattern | Task 3, 4 |
| POINTER event with dx drives velocityX + facing | Task 3 (tests), Task 4 (impl) |
| getCursorPos() polling in rAF, fire-and-forget | Task 5 |
| facing === 'left' → scaleX(-1) in spriteStyle | Task 5 |
| POINTER only active in performing state | Task 3 (POINTER in resting test), Task 4 |
| Hook split: useTauriSetup / useRafTick / useTauriPositionSync | Task 5 |
| looking state node exists (placeholder) | Task 4 |
| vite.config.js → vite.config.ts | Task 1 |
| index.html script → main.tsx | Task 6 |
| package.json test/typecheck scripts | Task 1 |

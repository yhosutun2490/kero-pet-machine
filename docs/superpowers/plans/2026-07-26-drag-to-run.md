# Drag-to-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace global-cursor-polling movement with OS-native window drag — pet only runs when being dragged, window follows cursor smoothly via `startDragging()`, animation direction is read from `cursorPosition()`.

**Architecture:** Tauri's `startDragging()` handles smooth window movement during drag. A new `dragging` XState state freezes machine `position` (preventing `useTauriPositionSync` from fighting the OS) while still advancing animation frames and updating `facing` via `cursorPosition()` polling. On `pointerup`, `outerPosition()` reads the actual window location and writes it back via `POSITION_SYNC` before `DRAG_END` transitions to `performing`.

**Tech Stack:** XState v5, React 18, Tauri v2 (`startDragging`, `outerPosition`, `cursorPosition`), Vitest

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/capabilities/default.json` | Add two Tauri permissions |
| `src/machines/keroMachine.ts` | Add `dragging` state, `POSITION_SYNC` event, `syncPosition` + `advanceDragFrame` actions; revert dx deadzone |
| `src/machines/keroMachine.test.ts` | Replace stale DRAG_START/DRAG_END tests; add dragging-state suite |
| `src/hooks/useKeroPet.ts` | Simplify `useRafTick`; add `useDragTracking`; expose `onPointerDown` |
| `src/App.tsx` | Wire `onPointerDown` onto `<main>` |
| `docs/animation-sync.md` | New — explains two-position model and sync strategy |

---

## Task 1: Tauri Permissions

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the two new permissions**

Open `src-tauri/capabilities/default.json` and add the two lines so the file reads:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Permissions needed for Kero to move its desktop window.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-current-monitor",
    "core:window:allow-set-background-color",
    "core:window:allow-set-position",
    "core:window:allow-start-dragging",
    "core:window:allow-outer-position",
    "core:webview:allow-set-webview-background-color"
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "chore: add start-dragging and outer-position Tauri permissions"
```

---

## Task 2: keroMachine — dragging state (TDD)

**Files:**
- Modify: `src/machines/keroMachine.ts`
- Modify: `src/machines/keroMachine.test.ts`

- [ ] **Step 1: Revert dx deadzone in `applyPointerVelocityContext`**

In `src/machines/keroMachine.ts`, find `applyPointerVelocityContext` and change:

```ts
// FROM (introduced in a previous session to suppress hover jitter — no longer needed with drag-only POINTER events)
facing: event.dx > 2 ? 'right' : event.dx < -2 ? 'left' : context.facing,
```

```ts
// TO
facing: event.dx > 0 ? 'right' : event.dx < 0 ? 'left' : context.facing,
```

- [ ] **Step 2: Replace stale DRAG tests + add dragging-state suite in test file**

In `src/machines/keroMachine.test.ts`, replace the entire `describe('DRAG_START / DRAG_END', ...)` block (lines 153–175) with:

```ts
describe('dragging state', () => {
  it('DRAG_START from performing enters dragging', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    expect(actor.getSnapshot().value).toBe('dragging');
  });

  it('DRAG_START from resting enters dragging', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'TAP' });
    actor.send({ type: 'DRAG_START' });
    expect(actor.getSnapshot().value).toBe('dragging');
  });

  it('TICK in dragging advances animation frame but leaves position unchanged', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    // Set velocity first so performing-TICK would move position.x — proving the test
    // actually fails before dragging state is implemented.
    actor.send({ type: 'POINTER', dx: 5 }); // velocityX = 300 in performing
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'TICK', dt: 1 / 60 });
    const s = actor.getSnapshot();
    expect(s.value).toBe('dragging');
    expect(s.context.position.x).toBe(100); // frozen — not 100 + 300*(1/60) ≈ 105
    expect(s.context.position.y).toBe(496);
    expect(s.context.frame).toBe(1);
  });

  it('POINTER in dragging updates facing', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    expect(actor.getSnapshot().value).toBe('dragging'); // guard: fails before impl
    actor.send({ type: 'POINTER', dx: -5 });
    expect(actor.getSnapshot().context.facing).toBe('left');
  });

  it('DRAG_END transitions to performing', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    expect(actor.getSnapshot().value).toBe('dragging'); // guard: fails before impl
    actor.send({ type: 'DRAG_END' });
    expect(actor.getSnapshot().value).toBe('performing');
  });

  it('POSITION_SYNC writes OS position into context while dragging', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'POSITION_SYNC', position: { x: 300, y: 200 } });
    const s = actor.getSnapshot();
    expect(s.context.position.x).toBe(300);
    expect(s.context.position.y).toBe(200);
  });

  it('position is preserved through POSITION_SYNC → DRAG_END → performing', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'POSITION_SYNC', position: { x: 300, y: 200 } });
    actor.send({ type: 'DRAG_END' });
    const s = actor.getSnapshot();
    expect(s.value).toBe('performing');
    expect(s.context.position.x).toBe(300);
    expect(s.context.position.y).toBe(200);
  });
});
```

- [ ] **Step 3: Run tests — verify new dragging tests fail, existing POINTER tests pass**

```bash
cd /Users/rafael/Documents/個人專案/kero-desktop-pet && npm test
```

Expected: the 7 new `dragging state` tests **FAIL** (state/event not implemented yet). The existing `POINTER` tests that use `dx: 2` should now **PASS** (deadzone reverted to `> 0`).

- [ ] **Step 4: Add `POSITION_SYNC` to `KeroEvent` union**

In `src/machines/keroMachine.ts`, find the `KeroEvent` type and add the new variant:

```ts
export type KeroEvent =
  | { type: 'BOUNDS'; bounds: { width: number; height: number } }
  | { type: 'POINTER'; dx: number }
  | { type: 'DRAG_START' }
  | { type: 'DRAG_END' }
  | { type: 'POSITION_SYNC'; position: { x: number; y: number } }
  | { type: 'TAP' }
  | { type: 'TICK'; dt: number };
```

- [ ] **Step 5: Add `advanceDragFrameContext` helper function**

Add this function after `advanceIdleFrameContext` in `src/machines/keroMachine.ts`. It advances animation exactly like `advanceActionFrameContext` but omits the position update so the machine coordinate is frozen during OS drag:

```ts
function advanceDragFrameContext(
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
    nowMs: context.nowMs + elapsedMs,
  };
}
```

- [ ] **Step 6: Wire new action and state into the machine**

Replace the entire `keroMachine` definition (from `export const keroMachine = setup({` to the closing `});`) with:

```ts
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
    syncPosition: assign(({ event }) => ({
      position: (event as Extract<KeroEvent, { type: 'POSITION_SYNC' }>).position,
      velocityX: 0,
    })),
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
    advanceDragFrame: assign(({ context, event }) =>
      advanceDragFrameContext(context, event as Extract<KeroEvent, { type: 'TICK' }>),
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
    POSITION_SYNC: { actions: 'syncPosition' },
  },
  initial: 'performing',
  states: {
    performing: {
      entry: { type: 'resetPerformance' },
      on: {
        TAP:        { target: 'resting' },
        TICK:       { actions: 'advanceActionFrame' },
        POINTER:    { actions: 'applyPointerVelocity' },
        DRAG_START: { target: 'dragging' },
      },
    },
    resting: {
      entry: { type: 'settleAtBottom' },
      on: {
        TAP:        { target: 'performing' },
        TICK:       { actions: 'advanceIdleFrame' },
        DRAG_START: { target: 'dragging' },
      },
    },
    dragging: {
      on: {
        TICK:     { actions: 'advanceDragFrame' },
        POINTER:  { actions: 'applyPointerVelocity' },
        DRAG_END: { target: 'performing' },
      },
    },
    looking: {
      on: { TICK: { actions: 'advanceIdleFrame' } },
    },
  },
});
```

- [ ] **Step 7: Run tests — all pass**

```bash
npm test
```

Expected: all tests **PASS**, including the 7 new dragging-state tests.

- [ ] **Step 8: Commit**

```bash
git add src/machines/keroMachine.ts src/machines/keroMachine.test.ts
git commit -m "feat: add dragging state with POSITION_SYNC to keroMachine"
```

---

## Task 3: Refactor useKeroPet for drag-based movement

**Files:**
- Modify: `src/hooks/useKeroPet.ts`

- [ ] **Step 1: Replace the entire content of `useKeroPet.ts`**

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

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

type Send = (event: KeroEvent) => void;

// Connects to Tauri window/webview, reads monitor bounds, sends BOUNDS event.
function useTauriSetup(send: Send): void {
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (!window.__TAURI_INTERNALS__) return;
      const [{ getCurrentWindow, currentMonitor }, { getCurrentWebview }] = await Promise.all([
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

      const monitor = await currentMonitor();
      const width = monitor?.workArea?.size?.width ?? 900;
      const height = monitor?.workArea?.size?.height ?? 600;
      send({ type: 'BOUNDS', bounds: { width, height } });
    }

    connect();
    return () => { cancelled = true; };
  }, [send]);
}

// rAF loop: sends TICK every frame.
function useRafTick(send: Send): void {
  const lastTickRef = useRef(performance.now());

  useEffect(() => {
    let frameId = 0;

    function tick(now: number) {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
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

// Handles pointer-down drag: calls startDragging(), polls cursorPosition() for
// animation direction, reads outerPosition() on release to sync machine state.
function useDragTracking(send: Send): { onPointerDown: () => void } {
  const stateRef = useRef({ dragging: false, prevX: null as number | null, frameId: 0 });

  useEffect(() => {
    const s = stateRef.current;

    // Preload Tauri module so first drag has no cold-import delay.
    if (window.__TAURI_INTERNALS__) {
      import('@tauri-apps/api/window');
    }

    async function onPointerUp() {
      if (!s.dragging) return;
      s.dragging = false;
      cancelAnimationFrame(s.frameId);
      s.prevX = null;
      if (window.__TAURI_INTERNALS__) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const pos = await getCurrentWindow().outerPosition();
        send({ type: 'POSITION_SYNC', position: { x: pos.x, y: pos.y } });
      }
      send({ type: 'DRAG_END' });
    }

    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      cancelAnimationFrame(s.frameId);
    };
  }, [send]);

  return {
    onPointerDown: () => {
      const s = stateRef.current;
      s.dragging = true;
      s.prevX = null;
      send({ type: 'DRAG_START' });

      if (!window.__TAURI_INTERNALS__) return;

      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        getCurrentWindow().startDragging();
      });

      function poll() {
        if (!s.dragging) return;
        import('@tauri-apps/api/window').then(({ cursorPosition }) =>
          cursorPosition().then((pos) => {
            if (s.prevX !== null) {
              const dx = pos.x - s.prevX;
              if (dx !== 0) send({ type: 'POINTER', dx });
            }
            s.prevX = pos.x;
          }),
        );
        s.frameId = requestAnimationFrame(poll);
      }
      s.frameId = requestAnimationFrame(poll);
    },
  };
}

export function useKeroPet(): {
  spriteStyle: CSSProperties;
  containerStyle: CSSProperties;
  onTap: () => void;
  onPointerDown: () => void;
} {
  const [snapshot, send] = useMachine(keroMachine, { input: {} });

  useTauriSetup(send);
  useRafTick(send);
  useTauriPositionSync(snapshot.context.position);
  const { onPointerDown } = useDragTracking(send);

  const spriteFrame = selectSpriteFrame(snapshot);
  const facing = snapshot.context.facing;

  const spriteStyle = useMemo<CSSProperties>(
    () => ({
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
      backgroundImage: 'url("/kerolet-spritesheet.webp")',
      backgroundPosition: `-${spriteFrame.column * CELL_WIDTH}px -${spriteFrame.row * CELL_HEIGHT}px`,
      transform: facing === 'left'
        ? `translateX(${CELL_WIDTH * PET_SCALE}px) scale(${PET_SCALE}) scaleX(-1)`
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
    onPointerDown,
  };
}
```

- [ ] **Step 2: Run tests to confirm nothing broken**

```bash
npm test
```

Expected: all tests **PASS** (hook is not covered by unit tests; machine tests are the contract).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useKeroPet.ts
git commit -m "feat: replace global cursor polling with drag-based useDragTracking"
```

---

## Task 4: Wire `onPointerDown` in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update App.tsx**

Replace the entire file content with:

```tsx
import { useKeroPet } from './hooks/useKeroPet';

export default function App() {
  const { spriteStyle, containerStyle, onTap, onPointerDown } = useKeroPet();
  return (
    <main
      className="pet-stage"
      onClick={onTap}
      onPointerDown={onPointerDown}
      style={containerStyle}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests **PASS**.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire onPointerDown drag handler into App"
```

---

## Task 5: Write animation-sync documentation

**Files:**
- Create: `docs/animation-sync.md`

- [ ] **Step 1: Create the file**

```markdown
# Animation Sync: How Kero's Position and Animation Stay in Sync During Drag

## The Two-Position Model

Kero's position is tracked in two places that must be kept in sync:

1. **Machine `position`** — `{ x, y }` stored in XState context. This is the source of truth for where the window *should* be. `useTauriPositionSync` watches it and calls `setPosition()` on every change.

2. **OS window position** — the actual physical position of the Tauri window on screen, managed by macOS/Windows.

During normal operation these are the same. During drag they temporarily diverge.

---

## Why Machine Position Must Freeze During Drag

When the user drags the pet, `startDragging()` hands window movement to the OS. The OS updates the window's screen position on every mouse move — without touching the machine.

If the machine kept computing position during this time (via TICK's `advanceActionFrame`), `useTauriPositionSync` would call `setPosition()` back to the old machine coordinates on every frame, fighting the OS drag. The window would stutter or snap back.

The fix: a dedicated `dragging` state whose TICK handler (`advanceDragFrame`) advances animation frames but **does not update `position`**. The machine coordinate is frozen; the OS moves the window freely.

---

## State Diagram

```
[performing / resting]
        │ pointerdown → DRAG_START
        ▼
    [dragging]
        │  TICK          → advanceDragFrame (animation only, position frozen)
        │  POINTER(dx)   → applyPointerVelocity (updates facing for direction)
        │  POSITION_SYNC → syncPosition (writes OS coords into machine)
        │
        │ pointerup:
        │   1. await outerPosition()     ← read actual window location from OS
        │   2. send POSITION_SYNC(x, y)  ← reunify machine with OS position
        │   3. send DRAG_END             ← transition back to performing
        ▼
  [performing]  ← machine.position now matches the window's real location
```

**Order matters:** `POSITION_SYNC` must arrive before `DRAG_END`. The `performing` entry action (`resetPerformance`) does not touch `position`, so the synced value is preserved into the new state.

---

## Why `cursorPosition()` Instead of DOM `pointermove` for Animation Direction

The Tauri window is 96 × 104 px. As soon as the user starts dragging, the cursor leaves the webview boundary. DOM `pointermove` — even with `setPointerCapture` — only fires within the OS window, so it stops delivering events almost immediately.

`cursorPosition()` is a Tauri API that reads the system-level global cursor coordinate. It works regardless of which window the cursor is over, making it the correct tool for tracking drag direction across the whole screen.

During drag, a `requestAnimationFrame` loop calls `cursorPosition()` each frame and computes `dx = pos.x - prevX`. A non-zero `dx` triggers a `POINTER` event, which updates `facing` and plays the running animation in the correct direction.

---

## POSITION_SYNC vs setPosition

`useTauriPositionSync` calls `setPosition()` outward (machine → OS window). `POSITION_SYNC` flows inward (OS window → machine). They are complementary:

| Direction | Mechanism | When |
|-----------|-----------|------|
| Machine → OS | `useTauriPositionSync` → `setPosition()` | Normal movement (TICK-driven) |
| OS → Machine | `POSITION_SYNC` event → `syncPosition` action | After drag ends |
```

- [ ] **Step 2: Commit**

```bash
git add docs/animation-sync.md
git commit -m "docs: add animation-sync explainer for drag position model"
```

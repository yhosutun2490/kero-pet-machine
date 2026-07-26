# Drag-to-Run Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During drag, display a running animation (row 1 = right, row 2 = left) at 80 ms/frame based on `context.facing`, instead of the current idle fallthrough.

**Architecture:** Two targeted changes — (1) `keroMachine.ts`: simplify `advanceDragFrameContext` to use `RUN_FRAME_MS`, and update `selectSpriteFrame` to return the correct run row based on facing. (2) `useKeroPet.ts`: skip the CSS `scaleX(-1)` flip during `dragging` since rows 1 and 2 are already directional.

**Tech Stack:** XState v5, Vitest, React, Tauri

---

## Files

| File | Change |
|------|--------|
| `src/machines/keroMachine.ts` | Add `RUN_FRAMES`/`RUN_FRAME_MS` constants; simplify `advanceDragFrameContext`; add dragging branch in `selectSpriteFrame` |
| `src/machines/keroMachine.test.ts` | Update dragging TICK frame expectation; add two `selectSpriteFrame` dragging tests |
| `src/hooks/useKeroPet.ts` | Skip CSS flip when `snapshot.value === 'dragging'` |

---

## Task 1: Update tests — dragging frame timing and run sprite rows

**Files:**
- Modify: `src/machines/keroMachine.test.ts`

The existing "TICK in dragging" test was written for the old frame timing (160 ms = IDLE_FRAME_MS).
After this task the tests will be RED — that's expected.

- [ ] **Step 1: Update the dragging TICK frame expectation**

In `src/machines/keroMachine.test.ts`, find the test `'TICK in dragging advances animation frame but leaves position unchanged'` (line ~171).
Change the comment and expectation for `frame`:

Before:
```ts
actor.send({ type: 'TICK', dt: 0.17 }); // dt=0.17 (170ms > frameMs=160ms) → 1 animation step; velocityX=300 means
// ...
expect(s.context.frame).toBe(1);        // 170ms / 160ms = 1 step
```

After:
```ts
actor.send({ type: 'TICK', dt: 0.17 }); // 170ms / RUN_FRAME_MS(80ms) = 2 steps; velocityX=300 means
// ...
expect(s.context.frame).toBe(2);        // 170ms / 80ms = 2 steps
```

- [ ] **Step 2: Add `selectSpriteFrame` tests for dragging state**

Append inside the `describe('dragging state', ...)` block, after the existing tests:

```ts
it('selectSpriteFrame returns run-right row when dragging facing right', () => {
  const actor = createActor(keroMachine, {
    input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
  }).start();
  actor.send({ type: 'DRAG_START' });
  actor.send({ type: 'POINTER', dx: 3 }); // facing = right
  const s = actor.getSnapshot();
  expect(s.value).toBe('dragging');
  expect(selectSpriteFrame(s)).toEqual({ row: 1, column: 0 });
});

it('selectSpriteFrame returns run-left row when dragging facing left', () => {
  const actor = createActor(keroMachine, {
    input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
  }).start();
  actor.send({ type: 'DRAG_START' });
  actor.send({ type: 'POINTER', dx: -3 }); // facing = left
  const s = actor.getSnapshot();
  expect(s.value).toBe('dragging');
  expect(selectSpriteFrame(s)).toEqual({ row: 2, column: 0 });
});
```

- [ ] **Step 3: Run tests and confirm they fail**

```bash
npm test
```

Expected: 3 failures —
- `TICK in dragging advances animation frame...` → received `1`, expected `2`
- `selectSpriteFrame returns run-right row...` → received `{ row: 0, column: ... }`, expected `{ row: 1, column: 0 }`
- `selectSpriteFrame returns run-left row...` → received `{ row: 0, column: ... }`, expected `{ row: 2, column: 0 }`

---

## Task 2: Implement run animation in `keroMachine.ts`

**Files:**
- Modify: `src/machines/keroMachine.ts`

- [ ] **Step 1: Add `RUN_FRAMES` and `RUN_FRAME_MS` constants**

After the existing constants block (after `const IDLE_FRAME_MS = 160;`), add:

```ts
const RUN_FRAMES = 8;
const RUN_FRAME_MS = 80;
```

- [ ] **Step 2: Replace `advanceDragFrameContext` body**

Replace the entire function body (currently cycles through ACTIONS) with the simpler run-only version:

```ts
function advanceDragFrameContext(
  context: KeroContext,
  event: Extract<KeroEvent, { type: 'TICK' }>,
): Partial<KeroContext> {
  const elapsedMs = event.dt * 1000;
  const frameElapsed = context.frameElapsedMs + elapsedMs;
  const steps = Math.floor(frameElapsed / RUN_FRAME_MS);
  return {
    frame: (context.frame + steps) % RUN_FRAMES,
    frameElapsedMs: frameElapsed % RUN_FRAME_MS,
    nowMs: context.nowMs + elapsedMs,
  };
}
```

- [ ] **Step 3: Add dragging branch in `selectSpriteFrame`**

In `selectSpriteFrame`, add a branch before the final `return` (currently the default for dragging):

```ts
export function selectSpriteFrame(snapshot: StateFrom<typeof keroMachine>): KeroSpriteFrame {
  const { value, context } = snapshot;
  if (value === 'looking' && context.pointer) {
    return directionToSpriteCell(pointerDegrees(context.pointer));
  }
  if (value === 'resting') {
    return { row: 5, column: 4 };
  }
  if (value === 'dragging') {
    const row = context.facing === 'left' ? 2 : 1;
    return { row, column: context.frame % RUN_FRAMES };
  }
  if (value === 'performing') {
    const action = ACTIONS[context.actionIndex % ACTIONS.length];
    return { row: action.row, column: context.frame % action.frames };
  }
  return { row: 0, column: context.frame % 6 };
}
```

- [ ] **Step 4: Run tests and confirm they all pass**

```bash
npm test
```

Expected: all tests pass, including the 3 that were failing.

- [ ] **Step 5: Commit**

```bash
git add src/machines/keroMachine.ts src/machines/keroMachine.test.ts
git commit -m "feat: show run animation (rows 1/2) during drag based on facing direction"
```

---

## Task 3: Disable CSS flip during drag in `useKeroPet.ts`

**Files:**
- Modify: `src/hooks/useKeroPet.ts`

Rows 1 and 2 are already facing the correct direction. Applying `scaleX(-1)` while dragging facing left would double-flip row 2 and make the sprite face right instead of left.

- [ ] **Step 1: Read `snapshot.value` and guard the flip**

In `useKeroPet`, the `spriteStyle` memo currently reads `facing` from `snapshot.context.facing`.
Add `snapshot.value` to the memo and guard the flip:

```ts
const spriteStyle = useMemo<CSSProperties>(
  () => ({
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    backgroundImage: 'url("/kerolet-spritesheet.webp")',
    backgroundPosition: `-${spriteFrame.column * CELL_WIDTH}px -${spriteFrame.row * CELL_HEIGHT}px`,
    transform:
      facing === 'left' && snapshot.value !== 'dragging'
        ? `translateX(${CELL_WIDTH * PET_SCALE}px) scale(${PET_SCALE}) scaleX(-1)`
        : `scale(${PET_SCALE})`,
  }),
  [spriteFrame.column, spriteFrame.row, facing, snapshot.value],
);
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass (no regression).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useKeroPet.ts
git commit -m "fix: skip scaleX flip during drag — run rows 1/2 are already directional"
```

# Drag-to-Run Design

**Date:** 2026-07-26
**Status:** Approved

## Goal

Change Kero's movement trigger from "react to any global cursor movement" to "only run when the user is actively dragging the pet window." While dragging, the OS moves the window natively (smooth), and the pet plays a running animation facing the drag direction. On release, the pet stays at the dropped position.

---

## Behavior

| Situation | Behavior |
|-----------|----------|
| Idle | `performing` / `resting` state, animation plays, window stays put |
| Pointer down on pet | Enter `dragging` state, call `startDragging()`, OS takes over window movement |
| Dragging | `cursorPosition()` polling computes dx → updates facing + running animation; machine `position` does NOT update |
| Pointer up | `outerPosition()` reads actual OS window position → `POSITION_SYNC` event → return to `performing` |

---

## Architecture

### Why two "positions"?

The XState machine holds a logical `position: { x, y }` that represents where the window should be. `useTauriPositionSync` is the bridge that calls Tauri's `setPosition()` whenever machine position changes.

During drag, the OS owns the window position. If the machine also tried to update position via TICK events, `useTauriPositionSync` would fight the OS on every frame. The solution: freeze machine `position` during drag (the `dragging` state's TICK only advances animation frames), then write the OS-determined position back to the machine on release via `POSITION_SYNC`.

### State transitions

```
[performing / resting]
        │ pointerdown
        ▼
    [dragging] ── TICK: advance animation frames only, position unchanged
        │          cursorPosition() polling → dx → facing / running animation
        │ pointerup
        │ await outerPosition() → POSITION_SYNC({ x, y })
        ▼
  [performing]  ← position now reflects actual OS window location
```

---

## Machine Changes (`keroMachine.ts`)

### Running animation sprite rows

| Row | Direction | Frames | Frame timing |
|-----|-----------|--------|-------------|
| 1 | Right | 8 | 80 ms |
| 2 | Left | 8 | 80 ms |

Direction is chosen from `context.facing`. No CSS `scaleX(-1)` flip is applied during `dragging` because rows 1 and 2 are already directional.

### New constants

```ts
const RUN_FRAMES = 8;
const RUN_FRAME_MS = 80;
```

### New state: `dragging`

- **TICK**: advance run animation frames using `RUN_FRAME_MS` timing; do NOT update `position` or `velocityX`
- **POINTER**: update `facing` for run row selection
- **DRAG_END**: transition to `performing`

### `selectSpriteFrame` — dragging case

```ts
if (value === 'dragging') {
  const row = context.facing === 'left' ? 2 : 1;
  return { row, column: context.frame % RUN_FRAMES };
}
```

### New events

| Event | Payload | Purpose |
|-------|---------|---------|
| `DRAG_START` | — | Enter `dragging` state |
| `DRAG_END` | — | Exit `dragging` state |
| `POSITION_SYNC` | `{ x: number, y: number }` | Write OS window position back to machine |

### New action: `syncPosition`

```ts
syncPosition: assign(({ event }) => ({
  position: (event as Extract<KeroEvent, { type: 'POSITION_SYNC' }>).position,
  velocityX: 0,
}))
```

### Removed constraint

The `bottomY` pin in TICK handlers is kept for `performing` / `resting`. In `dragging`, position is frozen — no pin needed. After `POSITION_SYNC`, the pet stays at the dropped Y coordinate (no snap-to-bottom).

---

## Hook Changes (`useKeroPet.ts`)

### `useRafTick` — simplified

Remove the existing `cursorPosition()` global polling. The hook now only sends `TICK` each frame.

### New hook: `useDragTracking`

```
pointerdown on pet element
  → appWindow.startDragging()       // OS takes over window movement
  → send DRAG_START
  → set dragging flag

rAF loop (only while dragging flag is set)
  → cursorPosition()                // global physical cursor position
  → compute dx from previous frame
  → send POINTER(dx) for facing + animation

pointerup (global window listener)
  → clear dragging flag
  → await getCurrentWindow().outerPosition()
  → send POSITION_SYNC({ x, y })   // must arrive BEFORE DRAG_END
  → send DRAG_END                  // transitions to performing with updated position
```

**Why `cursorPosition()` instead of DOM `pointermove`:**
The Tauri window is 96×104 px. The cursor leaves the webview boundary almost immediately when dragging. DOM `pointermove` (even with `setPointerCapture`) only fires within the webview; it cannot track a cursor that has moved outside the OS window. `cursorPosition()` reads the system-level global cursor coordinate and works regardless of window boundaries.

### `useTauriPositionSync` — no changes needed

In `dragging` state, machine `position` is frozen. The effect dependency `[position.x, position.y]` never fires during drag, so no `setPosition` calls fight the OS.

### `spriteStyle` transform — no flip during drag

Rows 1 and 2 are already directional, so `scaleX(-1)` must NOT be applied in the `dragging` state:

```ts
const isDragging = snapshot.value === 'dragging';
transform: (facing === 'left' && !isDragging)
  ? `translateX(${CELL_WIDTH * PET_SCALE}px) scale(${PET_SCALE}) scaleX(-1)`
  : `scale(${PET_SCALE})`,
```

### `useKeroPet` return type

Add `onPointerDown: React.PointerEventHandler` to the returned object.

---

## Tauri Changes

### New permission (`capabilities/default.json`)

```json
"core:window:allow-start-dragging",
"core:window:allow-outer-position"
```

### `outerPosition()` permission

Add `core:window:allow-outer-position` explicitly — it is not guaranteed to be included in `core:window:default`.

---

## App Layer (`App.tsx`)

Add `onPointerDown` to `<main className="pet-stage">`.

---

## Documentation

New file: `docs/animation-sync.md`

Covers:
1. The two-position model (machine vs OS window)
2. Why machine position is frozen during drag and how `POSITION_SYNC` reunifies them
3. Why `cursorPosition()` is used instead of DOM events for animation direction tracking
4. Annotated state diagram

---

## Files Changed

| File | Change |
|------|--------|
| `src/machines/keroMachine.ts` | Add `dragging` state, 3 new events, `syncPosition` action |
| `src/hooks/useKeroPet.ts` | Simplify `useRafTick`, add `useDragTracking`, update return type |
| `src/App.tsx` | Add `onPointerDown` prop |
| `src-tauri/capabilities/default.json` | Add `allow-start-dragging` permission |
| `docs/animation-sync.md` | New file — animation sync explanation |

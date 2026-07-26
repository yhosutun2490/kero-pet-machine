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

---

## Multi-Monitor / Extended Display

### The Problem

Physical screen coordinates are global. A secondary monitor to the right of the primary might use x ≥ 1920; one to the left uses negative x values. Two mechanisms originally caused the pet to snap back when dropped on an extended display:

**1. `clampX` in `advanceActionFrameContext`**

```ts
// OLD — caused snap-back
x: clampX(context.position.x + context.velocityX * event.dt, context.bounds)

// clampX: Math.max(0, Math.min(x, bounds.width - PET_WINDOW_WIDTH))
```

`Math.max(0, ...)` clips negative x (left monitor). `Math.min(x, bounds.width - ...)` clips x beyond the primary monitor width (right monitor). The first TICK after `DRAG_END` would clamp the synced position back into primary-monitor range.

**2. `bounds.width` only covered the primary monitor**

`BOUNDS` was set from `currentMonitor().workArea.size`, so `clampX` had no knowledge of secondary monitors at all.

### The Fix

**Remove `clampX` from `advanceActionFrameContext`.**

In `performing` state, `velocityX` is always 0 when TICK fires — `POINTER` events only arrive during active drag, which routes to the `dragging` state. So the clamp was a no-op for normal operation and only caused harm after drop. Position now just carries forward unchanged:

```ts
x: context.position.x + context.velocityX * event.dt,  // velocityX is always 0 here
```

**`syncPosition` auto-expands `bounds.width`** when the dropped position exceeds it (right monitor):

```ts
const width = Math.max(context.bounds.width, pos.x + PET_WINDOW_WIDTH);
bounds: width > context.bounds.width ? { ...context.bounds, width } : context.bounds,
```

This ensures that even if `availableMonitors()` fails or the monitor layout changes, the bounds always include where the OS actually placed the window.

### Remaining Limitation

`bottomY` (the floor the pet rests on) is derived from the primary monitor's work-area height. If monitors have different heights, the pet's resting Y on a taller secondary monitor may not be at that monitor's visual bottom. This is acceptable for the current design — the pet's floor is defined by the primary display.

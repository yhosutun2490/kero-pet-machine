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
    actor.send({ type: 'POINTER', dx: -5 }); // set facing to 'left' while in performing
    actor.send({ type: 'TAP' }); // → resting
    actor.send({ type: 'POINTER', dx: 10 }); // should be ignored
    const s = actor.getSnapshot();
    expect(s.value).toBe('resting');
    expect(s.context.velocityX).toBe(0);
    expect(s.context.facing).toBe('left'); // facing must not be reset by resting or ignored POINTER
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

  it('resets frame to 0 when entering dragging state', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    // Advance frame in performing state
    actor.send({ type: 'TICK', dt: 0.17 }); // 170ms / 160ms = 1 step → frame=1
    expect(actor.getSnapshot().context.frame).toBe(1); // guard: confirm frame advanced
    actor.send({ type: 'DRAG_START' });
    expect(actor.getSnapshot().context.frame).toBe(0); // must reset on entry
  });

  it('TICK in dragging advances animation frame but leaves position unchanged', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    // 170ms / RUN_FRAME_MS(80ms) = 2 steps; velocityX=300 means
    // performing-TICK would move position.x to 151, proving the freeze is real.
    actor.send({ type: 'POINTER', dx: 5 }); // velocityX = 300
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'TICK', dt: 0.17 });
    const s = actor.getSnapshot();
    expect(s.value).toBe('dragging');
    expect(s.context.position.x).toBe(100); // frozen — performing would give 100 + 300*0.17 = 151
    expect(s.context.position.y).toBe(496);
    expect(s.context.frame).toBe(2);        // 170ms / 80ms = 2 steps
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

  it('POSITION_SYNC + TICK preserves position on right-side extended display', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 1920, height: 1080 }, position: { x: 100, y: 976 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'POSITION_SYNC', position: { x: 2100, y: 300 } });
    actor.send({ type: 'DRAG_END' });
    actor.send({ type: 'TICK', dt: 1 / 60 });
    expect(actor.getSnapshot().context.position.x).toBe(2100);
  });

  it('POSITION_SYNC + TICK preserves position on left-side extended display (negative x)', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 1920, height: 1080 }, position: { x: 100, y: 976 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'POSITION_SYNC', position: { x: -500, y: 300 } });
    actor.send({ type: 'DRAG_END' });
    actor.send({ type: 'TICK', dt: 1 / 60 });
    expect(actor.getSnapshot().context.position.x).toBe(-500);
  });

  it('TICK in performing preserves dropped Y after drag', () => {
    const actor = createActor(keroMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 100, y: 496 } },
    }).start();
    actor.send({ type: 'DRAG_START' });
    actor.send({ type: 'POSITION_SYNC', position: { x: 300, y: 200 } });
    actor.send({ type: 'DRAG_END' });
    actor.send({ type: 'TICK', dt: 1 / 60 });
    const s = actor.getSnapshot();
    expect(s.value).toBe('performing');
    expect(s.context.position.x).toBe(300);
    expect(s.context.position.y).toBe(200); // must NOT snap to bottomY (496)
  });

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

import { setup, assign } from 'xstate';
import type { StateFrom } from 'xstate';

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const PET_SCALE = 0.5;
export const PET_WINDOW_WIDTH = CELL_WIDTH * PET_SCALE;
export const PET_WINDOW_HEIGHT = CELL_HEIGHT * PET_SCALE;

const IDLE_FRAME_MS = 160;
const RUN_FRAMES = 8;
const RUN_FRAME_MS = 80;
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
  | { type: 'POSITION_SYNC'; position: { x: number; y: number } }
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

export function clampX(x: number, bounds: { width: number; height: number }): number {
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

// --- Action helpers ---

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
      y: context.position.y,
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
    position: { x: context.position.x, y: context.position.y },
    nowMs: context.nowMs + elapsedMs,
  };
}

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
    resetDragFrame: assign({
      frame: 0,
      frameElapsedMs: 0,
    }),
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
      entry: { type: 'resetDragFrame' },
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

// --- selectSpriteFrame (uses StateFrom after machine is defined) ---

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

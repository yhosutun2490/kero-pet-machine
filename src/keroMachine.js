export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const PET_SCALE = 0.5;
export const PET_WINDOW_WIDTH = CELL_WIDTH * PET_SCALE;
export const PET_WINDOW_HEIGHT = CELL_HEIGHT * PET_SCALE;

const IDLE_FRAME_MS = 160;
const ACTIONS = [
  { id: 'idle', row: 0, frames: 6, frameMs: IDLE_FRAME_MS, durationMs: 4000 },
  { id: 'waving', row: 3, frames: 4, frameMs: 140, durationMs: 2200 },
  { id: 'jumping', row: 4, frames: 5, frameMs: 140, durationMs: 2600 },
  { id: 'review', row: 8, frames: 6, frameMs: 150, durationMs: 3000 },
];
const LOOK_LABELS = [
  '000',
  '022.5',
  '045',
  '067.5',
  '090',
  '112.5',
  '135',
  '157.5',
  '180',
  '202.5',
  '225',
  '247.5',
  '270',
  '292.5',
  '315',
  '337.5',
];

export function createInitialKeroState(overrides = {}) {
  const bounds = overrides.bounds ?? { width: 900, height: 600 };
  const position = overrides.position ?? { x: 120, y: bottomY(bounds) };

  return {
    mode: 'performing',
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
    ...overrides,
  };
}

export function keroReducer(state, event) {
  switch (event.type) {
    case 'bounds':
      return {
        ...state,
        bounds: event.bounds,
        position: pinToBottom(state.position, event.bounds),
      };
    case 'pointer':
      return state;
    case 'drag-start':
      return state;
    case 'drag-end':
      return state;
    case 'tap':
      return toggleResting(state);
    case 'tick':
      return stepKero(state, event.dt);
    default:
      return state;
  }
}

export function selectSpriteFrame(state) {
  if (state.mode === 'looking' && state.pointer) {
    return directionToSpriteCell(pointerDegrees(state.pointer));
  }

  if (state.mode === 'resting') {
    return { row: 5, column: 4 };
  }

  if (state.mode === 'performing') {
    const action = ACTIONS[state.actionIndex % ACTIONS.length];
    return { row: action.row, column: state.frame % action.frames };
  }

  return { row: 0, column: state.frame % 6 };
}

export function directionToSpriteCell(degrees) {
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  const row = index < 8 ? 9 : 10;
  const column = index < 8 ? index : index - 8;
  return { row, column, label: LOOK_LABELS[index] };
}

function stepKero(state, dtSeconds) {
  const nowMs = state.nowMs + dtSeconds * 1000;
  const mode = state.mode;
  const animation = advanceFrame(state, mode, dtSeconds);

  return {
    ...state,
    ...animation,
    mode,
    nowMs,
    position: pinToBottom(state.position, state.bounds),
    velocityX: 0,
  };
}

function toggleResting(state) {
  if (state.mode === 'resting') {
    return {
      ...state,
      mode: 'performing',
      velocityX: 0,
      actionIndex: 0,
      actionElapsedMs: 0,
      frame: 0,
      frameElapsedMs: 0,
    };
  }

  return {
    ...state,
    mode: 'resting',
    position: {
      ...state.position,
      y: Math.max(0, state.bounds.height - PET_WINDOW_HEIGHT),
    },
    velocityX: 0,
    pointer: null,
    frame: 0,
    frameElapsedMs: 0,
  };
}

function advanceFrame(state, mode, dtSeconds) {
  if (mode === 'performing') {
    return advanceActionFrame(state, dtSeconds);
  }

  const frameCount = 6;
  const frameMs = IDLE_FRAME_MS;
  const elapsed = state.frameElapsedMs + dtSeconds * 1000;
  const steps = Math.floor(elapsed / frameMs);

  return {
    frame: (state.frame + steps) % frameCount,
    frameElapsedMs: elapsed % frameMs,
  };
}

function advanceActionFrame(state, dtSeconds) {
  const elapsedMs = dtSeconds * 1000;
  let actionIndex = state.actionIndex % ACTIONS.length;
  let actionElapsedMs = state.actionElapsedMs + elapsedMs;

  while (actionElapsedMs >= ACTIONS[actionIndex].durationMs) {
    actionElapsedMs -= ACTIONS[actionIndex].durationMs;
    actionIndex = (actionIndex + 1) % ACTIONS.length;
  }

  const action = ACTIONS[actionIndex];
  const frameElapsed = state.frameElapsedMs + elapsedMs;
  const steps = Math.floor(frameElapsed / action.frameMs);

  return {
    actionIndex,
    actionElapsedMs,
    frame: (state.frame + steps) % action.frames,
    frameElapsedMs: frameElapsed % action.frameMs,
  };
}

function clampPosition(position, bounds) {
  return {
    x: Math.max(0, Math.min(position.x, bounds.width - PET_WINDOW_WIDTH)),
    y: Math.max(0, Math.min(position.y, bounds.height - PET_WINDOW_HEIGHT)),
  };
}

function pinToBottom(position, bounds) {
  return {
    ...clampPosition(position, bounds),
    y: bottomY(bounds),
  };
}

function bottomY(bounds) {
  return Math.max(0, bounds.height - PET_WINDOW_HEIGHT);
}

function pointerDegrees(pointer) {
  const center = { x: PET_WINDOW_WIDTH / 2, y: PET_WINDOW_HEIGHT / 2 };
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const radians = Math.atan2(dx, -dy);
  return (radians * 180) / Math.PI;
}

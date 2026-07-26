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

// Suppress unused variable warnings for constants reserved for Task 4
void VELOCITY_SCALE;
void MAX_SPEED;
void pinToBottom;

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  PET_SCALE,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH,
  createInitialKeroState,
  directionToSpriteCell,
  keroReducer,
  selectSpriteFrame,
} from './keroMachine.js';

test('desktop window renders Kero at half-size', () => {
  assert.equal(PET_SCALE, 0.5);
  assert.equal(PET_WINDOW_WIDTH, CELL_WIDTH * PET_SCALE);
  assert.equal(PET_WINDOW_HEIGHT, CELL_HEIGHT * PET_SCALE);
});

test('initial state is fixed at the bottom and uses an action row', () => {
  const state = createInitialKeroState({
    bounds: { width: 500, height: 400 },
  });

  assert.equal(state.mode, 'performing');
  assert.equal(state.position.y, 296);
  assert.equal(state.velocityX, 0);
  assert.equal(selectSpriteFrame(state).row, 0);
});

test('tick advances animation without moving across the screen', () => {
  const state = createInitialKeroState({
    bounds: { width: 500, height: 400 },
    position: { x: 120, y: 296 },
    velocityX: 0,
    mode: 'performing',
    facing: 'right',
  });

  const next = keroReducer(state, { type: 'tick', dt: 1 });

  assert.equal(next.position.x, 120);
  assert.equal(next.position.y, 296);
  assert.equal(next.velocityX, 0);
  assert.equal(selectSpriteFrame(next).row, 0);
});

test('bounds changes keep Kero fixed to the bottom', () => {
  const state = createInitialKeroState({
    bounds: { width: 500, height: 400 },
    position: { x: 120, y: 80 },
  });

  const next = keroReducer(state, { type: 'bounds', bounds: { width: 700, height: 600 } });

  assert.equal(next.position.x, 120);
  assert.equal(next.position.y, 496);
});

test('animation frames advance with elapsed time', () => {
  const state = createInitialKeroState({
    frame: 0,
    frameElapsedMs: 0,
    mode: 'performing',
    facing: 'right',
  });

  const next = keroReducer(state, { type: 'tick', dt: 0.17 });

  assert.equal(next.frame, 1);
});

test('pointer angle maps to v2 look rows and columns', () => {
  assert.deepEqual(directionToSpriteCell(0), { row: 9, column: 0, label: '000' });
  assert.deepEqual(directionToSpriteCell(90), { row: 9, column: 4, label: '090' });
  assert.deepEqual(directionToSpriteCell(180), { row: 10, column: 0, label: '180' });
  assert.deepEqual(directionToSpriteCell(270), { row: 10, column: 4, label: '270' });
  assert.deepEqual(directionToSpriteCell(337), { row: 10, column: 7, label: '337.5' });
});

test('pointer movement is ignored so Kero keeps acting autonomously', () => {
  const state = createInitialKeroState({
    mode: 'performing',
    facing: 'right',
    position: { x: 100, y: 100 },
    velocityX: 0,
  });

  const next = keroReducer(state, {
    type: 'pointer',
    pointer: { x: 180, y: 20 },
  });

  assert.equal(next.mode, 'performing');
  assert.equal(next.velocityX, 0);
  assert.equal(next.pointer, null);
  assert.equal(selectSpriteFrame(next).row, 0);
});

test('pointer press is ignored so touching Kero does not freeze actions', () => {
  const state = createInitialKeroState({
    mode: 'performing',
    facing: 'right',
    position: { x: 100, y: 100 },
    velocityX: 0,
  });

  const pressed = keroReducer(state, { type: 'drag-start' });
  const next = keroReducer(pressed, { type: 'tick', dt: 1 });

  assert.equal(pressed.mode, 'performing');
  assert.equal(next.position.x, 100);
  assert.equal(selectSpriteFrame(next).row, 0);
});

test('pointer release is ignored so autonomous actions are not restarted accidentally', () => {
  const state = createInitialKeroState({
    mode: 'resting',
    position: { x: 240, y: 392 },
    velocityX: 0,
  });

  const released = keroReducer(state, { type: 'drag-end' });

  assert.equal(released.mode, 'resting');
  assert.equal(released.velocityX, 0);
});

test('tap makes Kero rest on the bottom of the screen', () => {
  const state = createInitialKeroState({
    bounds: { width: 800, height: 600 },
    position: { x: 240, y: 100 },
    velocityX: 0,
    mode: 'performing',
  });

  const resting = keroReducer(state, { type: 'tap' });

  assert.equal(resting.mode, 'resting');
  assert.equal(resting.position.y, 496);
  assert.equal(resting.velocityX, 0);
  assert.deepEqual(selectSpriteFrame(resting), { row: 5, column: 4 });
});

test('tap wakes Kero from resting and resumes actions', () => {
  const state = createInitialKeroState({
    mode: 'resting',
    position: { x: 240, y: 392 },
    velocityX: 0,
    facing: 'left',
  });

  const awake = keroReducer(state, { type: 'tap' });

  assert.equal(awake.mode, 'performing');
  assert.equal(awake.velocityX, 0);
  assert.equal(selectSpriteFrame(awake).row, 0);
});

test('Kero cycles through stationary action rows over time', () => {
  const state = createInitialKeroState({
    mode: 'performing',
    actionIndex: 0,
    actionElapsedMs: 0,
    position: { x: 240, y: 496 },
  });

  const next = keroReducer(state, { type: 'tick', dt: 4.1 });

  assert.equal(next.position.x, 240);
  assert.equal(selectSpriteFrame(next).row, 3);
});

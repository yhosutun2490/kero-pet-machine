import { useCallback, useEffect, useMemo, useRef } from 'react';
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
      const [{ getCurrentWindow, availableMonitors }, { getCurrentWebview }] = await Promise.all([
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

      const monitors = await availableMonitors();
      let width = 900, height = 600;
      for (const m of monitors) {
        const right = (m.position?.x ?? 0) + (m.size?.width ?? 0);
        const bottom = (m.position?.y ?? 0) + (m.size?.height ?? 0);
        if (right > width) width = right;
        if (bottom > height) height = bottom;
      }
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

  // Preload Tauri module so first drag has no cold-import delay.
  useEffect(() => {
    if (window.__TAURI_INTERNALS__) import('@tauri-apps/api/window');
  }, []);

  useEffect(() => {
    const s = stateRef.current;

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

  const onPointerDown = useCallback(() => {
    const s = stateRef.current;
    if (s.dragging) return;
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
  }, [send]);

  return { onPointerDown };
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
      transform:
        facing === 'left' && snapshot.value !== 'dragging'
          ? `translateX(${CELL_WIDTH * PET_SCALE}px) scale(${PET_SCALE}) scaleX(-1)`
          : `scale(${PET_SCALE})`,
    }),
    [spriteFrame.column, spriteFrame.row, facing, snapshot.value],
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

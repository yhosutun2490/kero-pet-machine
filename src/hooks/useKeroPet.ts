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

// rAF loop: sends TICK every frame. Also fire-and-forget polls getCursorPos()
// to send POINTER with dx to the machine.
function useRafTick(send: Send): void {
  const lastTickRef = useRef(performance.now());
  const prevCursorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let frameId = 0;

    function tick(now: number) {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      if (window.__TAURI_INTERNALS__) {
        import('@tauri-apps/api/window').then(({ cursorPosition }) => {
          cursorPosition().then((pos) => {
            const prev = prevCursorRef.current;
            if (prev) {
              const dx = pos.x - prev.x;
              if (dx !== 0) send({ type: 'POINTER', dx });
            }
            prevCursorRef.current = { x: pos.x, y: pos.y };
          });
        });
      }

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

export function useKeroPet(): {
  spriteStyle: CSSProperties;
  containerStyle: CSSProperties;
  onTap: () => void;
} {
  const [snapshot, send] = useMachine(keroMachine, { input: {} });

  useTauriSetup(send);
  useRafTick(send);
  useTauriPositionSync(snapshot.context.position);

  const spriteFrame = selectSpriteFrame(snapshot);
  const facing = snapshot.context.facing;

  const spriteStyle = useMemo<CSSProperties>(
    () => ({
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
      backgroundImage: 'url("/kerolet-spritesheet.webp")',
      backgroundPosition: `-${spriteFrame.column * CELL_WIDTH}px -${spriteFrame.row * CELL_HEIGHT}px`,
      transform: facing === 'left'
        ? `scale(${PET_SCALE}) scaleX(-1)`
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
  };
}

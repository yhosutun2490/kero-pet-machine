import { useEffect, useMemo, useReducer, useRef } from 'react';

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  PET_SCALE,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH,
  createInitialKeroState,
  keroReducer,
  selectSpriteFrame,
} from './keroMachine.js';

export default function App() {
  const [state, dispatch] = useReducer(keroReducer, undefined, () =>
    createInitialKeroState({
      position: { x: 80, y: 280 },
      velocityX: 0,
    }),
  );
  const tauriWindowRef = useRef(null);
  const lastTickRef = useRef(performance.now());
  const spriteFrame = selectSpriteFrame(state);
  const spriteStyle = useMemo(
    () => ({
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
      backgroundImage: 'url("/kerolet-spritesheet.webp")',
      backgroundPosition: `-${spriteFrame.column * CELL_WIDTH}px -${spriteFrame.row * CELL_HEIGHT}px`,
      transform: `scale(${PET_SCALE})`,
    }),
    [spriteFrame.column, spriteFrame.row],
  );

  useEffect(() => {
    let cancelled = false;

    async function connectTauriWindow() {
      if (!window.__TAURI_INTERNALS__) return;

      const [{ getCurrentWindow }, { PhysicalPosition }, { getCurrentWebview }] = await Promise.all([
        import('@tauri-apps/api/window'),
        import('@tauri-apps/api/dpi'),
        import('@tauri-apps/api/webview'),
      ]);
      if (cancelled) return;

      const appWindow = getCurrentWindow();
      const webview = getCurrentWebview();
      tauriWindowRef.current = { appWindow, PhysicalPosition };
      await Promise.allSettled([
        appWindow.setBackgroundColor([0, 0, 0, 0]),
        webview.setBackgroundColor([0, 0, 0, 0]),
      ]);

      const monitor = await appWindow.currentMonitor();
      const width = monitor?.workArea?.size?.width ?? 900;
      const height = monitor?.workArea?.size?.height ?? 600;
      dispatch({ type: 'bounds', bounds: { width, height } });
    }

    connectTauriWindow();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let frameId = 0;

    function tick(now) {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      dispatch({ type: 'tick', dt });
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const tauri = tauriWindowRef.current;
    if (!tauri) return;

    const { appWindow, PhysicalPosition } = tauri;
    appWindow.setPosition(
      new PhysicalPosition(Math.round(state.position.x), Math.round(state.position.y)),
    );
  }, [state.mode, state.position.x, state.position.y]);

  return (
    <main
      className="pet-stage"
      onClick={() => dispatch({ type: 'tap' })}
      style={{
        width: PET_WINDOW_WIDTH,
        height: PET_WINDOW_HEIGHT,
      }}
      title="Kero desktop pet"
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}

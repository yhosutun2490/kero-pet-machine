import { useCallback, useState } from 'react';
import {
  parseSettings,
  serializeSettings,
  STORAGE_KEY,
  type Settings,
} from '@/lib/settings';

/**
 * Chatboard settings backed by localStorage. Reads (and validates) once on
 * mount; `save` writes through so the value survives restarts. The parsing /
 * validation lives in the pure helpers in `@/lib/settings` (unit-tested there).
 */
export function useSettings(): [Settings, (next: Settings) => void] {
  const [settings, setSettings] = useState<Settings>(() =>
    parseSettings(readRaw()),
  );

  const save = useCallback((next: Settings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeSettings(next));
    } catch {
      // Persistence is best-effort; the in-memory value is still updated.
    }
  }, []);

  return [settings, save];
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

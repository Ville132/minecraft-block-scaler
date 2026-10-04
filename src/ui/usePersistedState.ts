/**
 * No automated test: a React hook wrapping the browser-only
 * `localStorage` API, same "no logic of its own worth testing in
 * isolation" category as `download.ts`/`textureDecoder.ts` — this
 * project's test setup has neither a DOM/React-render environment nor
 * a real `localStorage` to exercise it against. Verified manually
 * instead: change an option, reload the page, confirm it's retained.
 */
import { useState } from "react";

const STORAGE_KEY_PREFIX = "minecraft-block-scaler:";

function readPersisted<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // localStorage can be unavailable (private browsing, blocked site data)
    // or hold a value from an older, incompatible app version — either
    // way, falling back to the caller's own default is the same
    // first-ever-visit experience, not a broken one.
    return fallback;
  }
}

function writePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Same reasoning as archiveCache.ts's IndexedDB writes: persistence
    // is a convenience, not a requirement — a failed write just means
    // this one setting resets on the next visit, not that anything
    // about THIS visit is broken.
  }
}

/**
 * A `useState` whose initial value is read from `localStorage` and
 * whose every update is written back, so a choice like fill style or
 * variance weight survives a page reload the same way the uploaded
 * archive already does (see `archiveCache.ts`) — instead of only the
 * jar persisting while every other option quietly resets.
 *
 * `key` is scoped under one app-wide prefix so this app's own keys
 * never collide with anything else `localStorage` might hold for this
 * origin. Deliberately not validated beyond `JSON.parse` succeeding:
 * same risk level this app already accepts for `archiveCache.ts`'s
 * cast-without-validation IndexedDB read, not a new gap.
 */
export function usePersistedState<T>(key: string, fallback: T): readonly [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPersisted(key, fallback));
  function setPersistedValue(next: T): void {
    setValue(next);
    writePersisted(key, next);
  }
  return [value, setPersistedValue] as const;
}

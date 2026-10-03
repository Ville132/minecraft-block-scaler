/**
 * Persists the user's uploaded archive bytes in IndexedDB so they only
 * need to upload their jar/resource pack once, not on every visit —
 * the one piece of PLAN.md's asset-reading step that was missed in the
 * initial build (see PLAN.md's Open Items). Only one archive is ever
 * cached at a time, matching this tool's single-archive workflow.
 *
 * No automated test: IndexedDB does not exist in this project's Vitest
 * environment (plain Node, see vitest.config.ts) without a polyfill
 * package this plan did not call for. Covered by manual verification
 * instead — every function here is a thin, direct wrapper around
 * IndexedDB's own request/transaction API with no branching logic of
 * its own to get wrong.
 */

const DATABASE_NAME = "minecraft-block-scaler";
const DATABASE_VERSION = 1;
const STORE_NAME = "archives";
/** The only key ever used — this cache holds a single "current" archive, not a collection. */
const CURRENT_ARCHIVE_KEY = "current";

export interface CachedArchive {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly savedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the archive cache database"));
  });
}

/** Overwrites the cached archive with `bytes`. */
export async function saveCachedArchive(fileName: string, bytes: Uint8Array): Promise<void> {
  const db = await openDatabase();
  try {
    const cached: CachedArchive = { fileName, bytes, savedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(cached, CURRENT_ARCHIVE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the archive to cache"));
    });
  } finally {
    db.close();
  }
}

/** Returns the cached archive, or `undefined` if nothing has been cached yet — an expected, common state (e.g. a first visit), not an error. */
export async function loadCachedArchive(): Promise<CachedArchive | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<CachedArchive | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_ARCHIVE_KEY);
      request.onsuccess = () => resolve(request.result as CachedArchive | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not load the cached archive"));
    });
  } finally {
    db.close();
  }
}

/** Clears the cached archive — used when the user picks a different file to replace it. */
export async function clearCachedArchive(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(CURRENT_ARCHIVE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear the cached archive"));
    });
  } finally {
    db.close();
  }
}

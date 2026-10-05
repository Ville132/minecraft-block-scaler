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

/** Runtime check behind {@link loadCachedArchive}'s read — a stored value this app itself never wrote (a future, incompatible app version; manual tampering with devtools) is treated the same as nothing being cached at all, rather than trusted on a bare type cast. */
function isCachedArchive(value: unknown): value is CachedArchive {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fileName === "string" &&
    candidate.bytes instanceof Uint8Array &&
    typeof candidate.savedAt === "number"
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Lets this connection get out of a FUTURE version bump's way
      // instead of indefinitely blocking it — every operation in this
      // module already closes its own connection within one
      // open-transaction-close cycle, so this is cheap defense-in-depth
      // (a future refactor that holds a connection open longer, or a
      // close() that doesn't run because of an unexpected throw) rather
      // than a path this app's current usage actually exercises.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open the archive cache database"));
    // Without this, a blocked upgrade (another tab holding an open
    // connection at an older version) would leave this promise forever
    // unsettled — onupgradeneeded/onsuccess/onerror simply never fire
    // until the blocking connection closes. Failing loudly instead
    // means a caller's await actually returns (as a rejection, which
    // every call site already treats as "caching didn't work this
    // time") rather than hanging.
    request.onblocked = () => reject(new Error("Could not open the archive cache database (blocked by another open tab)"));
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

/** Returns the cached archive, or `undefined` if nothing has been cached yet (or what's stored doesn't look like a `CachedArchive` at all — see {@link isCachedArchive}) — both are an expected, common state (e.g. a first visit), not an error. */
export async function loadCachedArchive(): Promise<CachedArchive | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<CachedArchive | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_ARCHIVE_KEY);
      request.onsuccess = () => {
        const stored: unknown = request.result;
        resolve(isCachedArchive(stored) ? stored : undefined);
      };
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

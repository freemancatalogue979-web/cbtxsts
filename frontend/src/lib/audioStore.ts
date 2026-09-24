/**
 * The device's audio library — whole music files stored in IndexedDB so
 * playback reads from disk, never from the server.
 *
 * Why: streamed tracks fight the network for every buffer gap, and a proxy
 * or a cold connection shows up as audible crackle mid-phrase. A stored blob
 * is local data; the browser paces it however it likes. IndexedDB (not
 * localStorage) because these files are megabytes, and every failure path
 * degrades to "no cache" — the app keeps streaming like it always did.
 */

const DB_NAME = 'arena.audio';
const STORE = 'files';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function audioBlobGet(key: string): Promise<Blob | null> {
  const handle = await db();
  if (!handle) return null;
  return new Promise((resolve) => {
    try {
      const req = handle.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result instanceof Blob ? (req.result as Blob) : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function audioBlobPut(key: string, blob: Blob): Promise<boolean> {
  const handle = await db();
  if (!handle) return false;
  return new Promise((resolve) => {
    try {
      const tx = handle.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function audioBlobDeleteAll(): Promise<void> {
  const handle = await db();
  if (!handle) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = handle.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

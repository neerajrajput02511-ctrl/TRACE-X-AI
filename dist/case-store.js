const DB_NAME = 'tracex-cases-v1';
let connection;

export class DeviceStorageError extends Error {}

export function database() {
  if (connection) return connection;
  const opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    let failed = false;
    const timer = setTimeout(() => fail('Device storage did not respond.'), 4000);
    function fail(message, cause) {
      clearTimeout(timer);
      failed = true;
      reject(new DeviceStorageError(message, {cause}));
    }
    req.onupgradeneeded = () => req.result.createObjectStore('cases', {keyPath: 'id'});
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (failed) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
    req.onerror = () => fail('Device storage could not open.', req.error);
    req.onblocked = () => fail('Device storage is blocked by another TRACE-X tab.');
  });
  connection = opening.catch(error => {
    connection = undefined;
    if (error instanceof DeviceStorageError) throw error;
    throw new DeviceStorageError('Device storage is unavailable.', {cause:error});
  });
  return connection;
}

export async function listCases() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('cases').objectStore('cases').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (cause) {
    throw new DeviceStorageError('Saved cases could not be read from device storage.', {cause});
  }
}

// Each tab replaces one case atomically and may only replace the revision it opened.
export async function saveCase(item) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cases', 'readwrite');
    const store = tx.objectStore('cases');
    const req = store.get(item.id);
    let conflict = false;
    req.onsuccess = () => {
      if ((req.result?.revision || 0) !== (item.revision || 0)) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put({...item, revision: (item.revision || 0) + 1});
    };
    tx.oncomplete = () => { item.revision = (item.revision || 0) + 1; resolve(item); };
    tx.onabort = () => reject(new Error(conflict ? 'Another tab updated this case. Reopen the workspace to load the latest revision.' : 'The case could not be saved. Check device storage, then try again.'));
    tx.onerror = () => reject(tx.error);
  });
}

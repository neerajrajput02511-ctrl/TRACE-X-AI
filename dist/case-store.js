const DB_NAME = 'tracex-cases-v1';
let connection;

export function database() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('cases', {keyPath: 'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other TRACE-X tabs and reopen the workspace.'));
  });
  return connection;
}

export async function listCases() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction('cases').objectStore('cases').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

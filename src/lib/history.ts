import type { HistoryItem } from "../types";

const DB_NAME = "nai-image-studio";
const STORE = "history";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      // 请求完成仍可能回滚；只有整个事务提交后，界面才能更新为已保存。
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error("本地历史操作已回滚，请重试。"));
      tx.onerror = () => reject(tx.error ?? new Error("本地历史操作失败。"));
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
    });
  } finally {
    db.close();
  }
}

export async function addHistory(item: HistoryItem): Promise<void> {
  await withStore("readwrite", (s) => s.put(item));
}

export async function listHistory(): Promise<HistoryItem[]> {
  const all = await withStore<HistoryItem[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteHistory(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

export async function clearHistory(): Promise<void> {
  await withStore("readwrite", (s) => s.clear());
}

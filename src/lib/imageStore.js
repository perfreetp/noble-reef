// 图片二进制存 IndexedDB（localStorage 容量不足），文档 JSON 存 localStorage
// IDB 不可用（隐私模式/旧环境）时自动降级为内存 Map，保证编辑流程可用
import { DB_NAME, DB_STORE } from './constants.js';

let dbPromise = null;
const memoryFallback = new Map();
let useFallback = false;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      useFallback = true;
      reject(new Error('IndexedDB 不可用，已降级为内存存储'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      useFallback = true;
      reject(req.error);
    };
    req.onblocked = () => {
      useFallback = true;
      reject(new Error('IndexedDB 被占用'));
    };
  });
  return dbPromise;
}

async function tx(mode) {
  if (useFallback) return null;
  try {
    const db = await openDB();
    return db.transaction(DB_STORE, mode).objectStore(DB_STORE);
  } catch (err) {
    console.warn('[imageStore] 降级到内存存储：', err.message);
    useFallback = true;
    return null;
  }
}

function idbRequest(store, method, payload) {
  return new Promise((resolve, reject) => {
    const req = method === 'delete' ? store.delete(payload)
      : method === 'put' ? store.put(payload)
      : method === 'get' ? store.get(payload)
      : store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putImage(record) {
  const store = await tx('readwrite');
  if (!store) {
    memoryFallback.set(record.id, record);
    return record;
  }
  return idbRequest(store, 'put', record);
}

export async function getImage(id) {
  const store = await tx('readonly');
  if (!store) return memoryFallback.get(id) ?? null;
  return idbRequest(store, 'get', id).then((r) => r ?? null);
}

export async function getAllImages() {
  const store = await tx('readonly');
  if (!store) return [...memoryFallback.values()];
  const rows = await idbRequest(store, 'all');
  return rows ?? [];
}

export async function deleteImage(id) {
  const store = await tx('readwrite');
  if (!store) {
    memoryFallback.delete(id);
    return;
  }
  await idbRequest(store, 'delete', id);
}

/** 读取本地图片文件并压缩为 dataURL，附带自然尺寸 */
export function readImageFile(file, maxDim = 2400, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({
        w,
        h,
        name: file.name,
        dataUrl: canvas.toDataURL('image/jpeg', quality)
      });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

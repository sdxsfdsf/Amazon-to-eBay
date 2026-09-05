/* global chrome, indexedDB */
/* MV3 service worker: fetches original-quality Amazon image bytes and stores
   them as Blobs in IndexedDB (never huge base64 in chrome.storage.local). */

const DB_NAME = "aeb-images";
const STORE = "blobs";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function put(record) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const r = tx(db, "readwrite").put(record);
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
      }),
  );
}

function getAll() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const r = tx(db, "readonly").getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      }),
  );
}

function get(key) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const r = tx(db, "readonly").get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      }),
  );
}

function clearCapture(captureId) {
  return getAll().then((all) =>
    Promise.all(
      all
        .filter((r) => r.captureId !== captureId)
        .map(
          (r) =>
            new Promise((resolve) => {
              openDB().then((db) => {
                const req = tx(db, "readwrite").delete(r.key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
              });
            }),
        ),
    ),
  );
}

function extFor(mime, url) {
  if (/jpe?g/i.test(mime)) return "jpg";
  if (/png/i.test(mime)) return "png";
  if (/webp/i.test(mime)) return "webp";
  const m = String(url).match(/\.(jpe?g|png|webp)(?:\?|$)/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

async function bufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Fetch original bytes; no resizing, no re-encoding, no canvas. */
async function storeImages(captureId, urls) {
  await clearCapture(captureId);
  const seenHash = new Set();
  const stored = [];
  let index = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: "omit", cache: "force-cache" });
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      const mime = res.headers.get("content-type") || "image/jpeg";
      // Byte-level dedupe: same underlying image served under different URLs.
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (seenHash.has(hash)) continue;
      seenHash.add(hash);
      index += 1;
      const filename = `image-${String(index).padStart(2, "0")}.${extFor(mime, url)}`;
      const key = `${captureId}:${hash}`;
      await put({
        key,
        captureId,
        url,
        hash,
        mime,
        filename,
        order: index,
        size: buffer.byteLength,
        blob: new Blob([buffer], { type: mime }),
      });
      stored.push({ key, url, mime, filename, order: index, size: buffer.byteLength });
    } catch {
      /* skip unreachable image, never fabricate one */
    }
  }
  return stored;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "STORE_IMAGES") {
        const images = await storeImages(msg.captureId, msg.urls || []);
        sendResponse({ ok: true, images });
        return;
      }
      if (msg.type === "LIST_IMAGES") {
        const all = await getAll();
        const images = all
          .filter((r) => r.captureId === msg.captureId)
          .sort((a, b) => a.order - b.order)
          .map(({ key, url, mime, filename, order, size }) => ({ key, url, mime, filename, order, size }));
        sendResponse({ ok: true, images });
        return;
      }
      if (msg.type === "GET_IMAGE") {
        const rec = await get(msg.key);
        if (!rec) {
          sendResponse({ ok: false, error: "not found" });
          return;
        }
        const buffer = await rec.blob.arrayBuffer();
        sendResponse({ ok: true, base64: await bufferToBase64(buffer), mime: rec.mime, filename: rec.filename });
        return;
      }
      sendResponse({ ok: false, error: "unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});

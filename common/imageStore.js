/* global chrome, window */
/* Content-script side bridge to the service worker's IndexedDB image store. */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => resolve(res || { ok: false, error: "no response" }));
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  /** Ask the worker to fetch + persist original image bytes. Returns stored image metadata. */
  async function storeImages(captureId, urls) {
    const res = await send({ type: "STORE_IMAGES", captureId, urls });
    return res.ok ? res.images : [];
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  async function listImages(captureId) {
    const meta = await send({ type: "LIST_IMAGES", captureId });
    return meta.ok ? meta.images : [];
  }

  /**
   * Reconstruct real File objects on the eBay page, preserving original bytes/type.
   * `fallbackUrls` lets us re-fetch the SAME captured variant URLs if the blob store
   * was evicted; it never mixes in other variants.
   */
  async function getFiles(captureId, fallbackUrls) {
    let images = await listImages(captureId);
    if (!images.length && Array.isArray(fallbackUrls) && fallbackUrls.length) {
      await storeImages(captureId, fallbackUrls);
      images = await listImages(captureId);
    }
    const files = [];
    for (const item of images) {
      const res = await send({ type: "GET_IMAGE", key: item.key });
      if (!res.ok || !res.base64) continue;
      const blob = base64ToBlob(res.base64, res.mime);
      if (!blob.size) continue;
      files.push(new File([blob], item.filename, { type: res.mime, lastModified: Date.now() }));
    }
    return files;
  }

  Object.assign(AEB, { imageStore: { storeImages, listImages, getFiles, base64ToBlob } });
})();

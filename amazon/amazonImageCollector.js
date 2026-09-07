/* global window */
/*
 * Amazon current-variant image collector.
 *
 * IMPORTANT: the actual gallery-detection engine is intentionally the same
 * parser/variation/resolver used by the user's proven Amazon Image Downloader
 * 1.3.  This file is only an adapter from that engine into the AEB capture
 * shape (an ordered array of original-quality URLs).
 */
(function () {
  "use strict";

  const AEB = (window.AEB = window.AEB || {});
  const log = AEB.log || function () {};

  function fallbackOriginal(url) {
    try {
      const u = new URL(url, location.href);
      u.pathname = u.pathname.replace(
        /\/images\/I\/([^/]+?)(\.[_A-Za-z0-9,%+-]+)*(\.(?:jpg|jpeg|png|gif|webp))$/i,
        "/images/I/$1$3",
      );
      u.search = "";
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  function fallbackIdentity(url) {
    try {
      const u = new URL(url, location.href);
      const file = decodeURIComponent(u.pathname.split("/").pop() || "");
      let base = file.split(".")[0] || file;
      base = base.replace(/_(AC|SX|SY|SL|SS|SR|UL|UX|UY|CR|QL|FM|PI|US)\d*.*$/i, "");
      base = base.replace(/[_-]+$/, "");
      return base ? "id:" + base.toLowerCase() : "url:" + fallbackOriginal(u.toString()).toLowerCase();
    } catch (_) {
      return "url:" + String(url || "").toLowerCase();
    }
  }

  function collectCurrentVariantImages() {
    const resolver = window.AIDImages;
    if (!resolver || typeof resolver.collect !== "function") {
      log("Amazon Images", { error: "PROVEN_IMAGE_RESOLVER_NOT_AVAILABLE" });
      return [];
    }

    const resolved = resolver.collect();
    const urls = [];
    const seen = new Set();

    (resolved || []).forEach(function (entry) {
      const raw = entry && entry.url;
      if (!raw) return;
      const original = typeof resolver.toOriginal === "function" ? resolver.toOriginal(raw) : fallbackOriginal(raw);
      const id = typeof resolver.imageId === "function" ? resolver.imageId(original) : fallbackIdentity(original);
      if (!original || seen.has(id)) return;
      seen.add(id);
      urls.push(original);
    });

    log("Amazon Images", {
      collected: urls.length,
      resolverCandidates: Array.isArray(resolved) ? resolved.length : 0,
      engine: "amazon-image-downloader-1.3",
    });
    return urls;
  }

  AEB.amazonImages = {
    collectCurrentVariantImages,
    toOriginalUrl: function (url) {
      return window.AIDImages && typeof window.AIDImages.toOriginal === "function"
        ? window.AIDImages.toOriginal(url)
        : fallbackOriginal(url);
    },
    identityOf: function (url) {
      return window.AIDImages && typeof window.AIDImages.imageId === "function"
        ? window.AIDImages.imageId(url)
        : fallbackIdentity(url);
    },
    mainImageIdentity: function () {
      const main = document.querySelector(
        "#imgTagWrapperId img, #landingImage, #main-image-container img.a-dynamic-image, #ivLargeImage img",
      );
      if (!main) return null;
      const url = main.currentSrc || main.getAttribute("src") || main.getAttribute("data-old-hires");
      return url ? AEB.amazonImages.identityOf(url) : null;
    },
  };
})();

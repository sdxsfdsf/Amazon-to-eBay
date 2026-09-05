/* Collects the gallery images of the CURRENTLY selected variation and resolves
   the highest-quality Amazon-hosted URL for each, with dedupe by image id. */
(function () {
  "use strict";

  const P = window.AIDParser;

  /** Amazon image ids look like 71abcDEF12L._AC_SL1500_.jpg -> "71abcDEF12L". */
  function imageId(url) {
    try {
      const u = new URL(url, location.href);
      const file = decodeURIComponent(u.pathname.split("/").pop() || "");
      let base = file.split(".")[0] || file;
      base = base.replace(/_(AC|SX|SY|SL|SS|SR|UL|UX|UY|CR|QL|FM|PI|US)\d*.*$/i, "");
      base = base.replace(/[_-]+$/, "");
      return base ? "id:" + base.toLowerCase() : "url:" + toOriginal(u.toString()).toLowerCase();
    } catch (_) {
      return "url:" + String(url || "").toLowerCase();
    }
  }


  function extensionOf(url) {
    try {
      const file = new URL(url, location.href).pathname.split("/").pop() || "";
      const parts = file.split(".");
      const ext = parts[parts.length - 1].toLowerCase();
      return /^(jpg|jpeg|png|gif|webp)$/.test(ext) ? ext : "jpg";
    } catch (_) {
      return "jpg";
    }
  }

  /** Strip Amazon's resize/transform segment to request the original master file. */
  function toOriginal(url) {
    try {
      const u = new URL(url, location.href);
      // .../images/I/71abc._AC_SX679_.jpg  ->  .../images/I/71abc.jpg
      u.pathname = u.pathname.replace(
        /\/images\/I\/([^/]+?)(\.[_A-Za-z0-9,%+-]+)*(\.(?:jpg|jpeg|png|gif|webp))$/i,
        "/images/I/$1$3"
      );
      u.search = "";
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  function sizeScore(url) {
    const m = String(url).match(/_S[XY](\d+)_/i) || String(url).match(/_UL(\d+)_/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  /** Choose the best variant among candidate urls of the same image. */
  function bestOf(urls) {
    let best = null;
    let bestScore = -1;
    urls.forEach(function (u) {
      const score = /hiRes/.test(u.tag || "") ? 100000 : sizeScore(u.url) || (u.tag === "large" ? 1000 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    });
    return best;
  }

  function addUrl(list, url, tag) {
    if (!url || !P.isListingImageUrl(url)) return;
    if (list.some(function (item) { return item.url === url; })) return;
    list.push({ url: url, tag: tag || "other" });
  }

  function displayedUrl(img) {
    const candidates = [
      img.currentSrc,
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-lazy-src"),
    ];
    for (const url of candidates) {
      if (url && P.isListingImageUrl(url)) return url;
    }
    return null;
  }

  /**
   * Amazon often leaves data-old-hires/data-a-dynamic-image from the variant
   * that opened the page. Treat the image currently rendered by the browser as
   * the identity anchor and only accept quality aliases with that same image id.
   */
  function urlsFromElement(img) {
    const all = [];
    addUrl(all, img.currentSrc, "large");
    addUrl(all, img.getAttribute("src"), "large");
    addUrl(all, img.getAttribute("data-old-hires"), "hiRes");
    addUrl(all, img.getAttribute("data-src"), "thumb");
    addUrl(all, img.getAttribute("data-lazy-src"), "thumb");
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    srcset.split(",").forEach(function (part) {
      addUrl(all, part.trim().split(/\s+/)[0], "large");
    });
    const dyn = img.getAttribute("data-a-dynamic-image");
    if (dyn) {
      try {
        Object.keys(JSON.parse(dyn)).forEach(function (url) { addUrl(all, url, "large"); });
      } catch (_) {
        /* ignore malformed Amazon state */
      }
    }
    const visible = displayedUrl(img);
    if (!visible) return all;
    const visibleId = imageId(visible);
    const matching = all.filter(function (candidate) {
      return imageId(candidate.url) === visibleId;
    });
    if (matching.length !== all.length) {
      console.debug("[Amazon Image Downloader] Rejected stale element aliases", {
        visibleId: visibleId,
        rejected: all.length - matching.length,
      });
    }
    return matching;
  }

  /** Strategy A: colorImages data for the currently selected color/variant key. */
  function fromImageBlock() {
    const block = P.getImageBlockData();
    if (!block) return [];
    let list = null;

    // Amazon may keep `initial` tied to the variant used to open the page while
    // exposing live variant galleries under dimension-value keys.
    const variation = window.AIDVariation && window.AIDVariation.detect();
    const dimensions = variation && Array.isArray(variation.dimensions) ? variation.dimensions : [];
    dimensions.some(function (dimension) {
      const wanted = String(dimension.value || "").trim().toLowerCase();
      if (!wanted) return false;
      const key = Object.keys(block).find(function (candidate) {
        return candidate.trim().toLowerCase() === wanted;
      });
      if (key && Array.isArray(block[key]) && block[key].length) {
        list = block[key];
        return true;
      }
      return false;
    });

    // Single-variant pages generally expose only `initial`.
    if (!list && Array.isArray(block.initial) && block.initial.length) list = block.initial;
    if (!list) {
      const keys = Object.keys(block);
      for (const k of keys) {
        if (Array.isArray(block[k]) && block[k].length) {
          list = block[k];
          break;
        }
      }
    }
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      if (item.variant && /VIDEO|360|A_PLUS/i.test(String(item.variant))) return;
      const candidates = [];
      addUrl(candidates, item.hiRes, "hiRes");
      addUrl(candidates, item.large, "large");
      addUrl(candidates, item.mainUrl, "large");
      addUrl(candidates, item.thumb, "thumb");
      if (!candidates.length) return;
      const best = bestOf(candidates);
      out.push({
        url: best.url,
        aliases: candidates.map(function (candidate) { return candidate.url; }),
        source: "imageBlock",
        thumb: item.thumb || best.url,
      });
    });
    return out;
  }

  /** Strategy B: live gallery DOM (altImages thumbnails + main image data-a-dynamic-image). */
  function fromGalleryDom() {
    const out = [];
    const main = document.querySelector(
      "#imgTagWrapperId img, #landingImage, #main-image-container img.a-dynamic-image, #ivLargeImage img"
    );
    if (main) {
      const mainUrls = urlsFromElement(main);
      if (mainUrls.length) {
        const best = bestOf(mainUrls);
        out.push({
          url: best.url,
          aliases: mainUrls.map(function (candidate) { return candidate.url; }),
          source: "dom-main",
          thumb: displayedUrl(main) || best.url,
        });
      }
    }
    // Alt thumbnails belong to the CURRENT variation gallery only.
    let thumbIndex = 0;
    document
      .querySelectorAll("#altImages li.imageThumbnail img, #altImages li.item img, #altImages li.a-spacing-small img")
      .forEach(function (img) {
        const li = img.closest("li");
        if (li && /video|aplus|comparison|360/i.test(li.className)) return;
        const urls = urlsFromElement(img);
        if (!urls.length) return;
        thumbIndex++;
        // Amazon always renders the MAIN image again as the first gallery
        // thumbnail, but frequently under a DIFFERENT regenerated image id
        // (e.g. main 61yaNvNbIiL vs thumb 31qHfpzI5dL - pixel-identical), so
        // identity-based dedupe cannot merge them. When the main image was
        // already collected above, the first thumbnail is always that same
        // main photo: skip it so the first image is never duplicated.
        if (thumbIndex === 1 && out.length) {
          console.debug("[Amazon Image Downloader] Skipped first thumbnail (duplicate of main image)", {
            thumb: displayedUrl(img),
          });
          return;
        }
        const best = bestOf(urls);
        out.push({
          url: best.url,
          aliases: urls.map(function (candidate) { return candidate.url; }),
          source: "dom-thumb",
          thumb: displayedUrl(img) || best.url,
        });
      });
    return out;
  }

  function qualityScore(c) {
    let s = sizeScore(c.url);
    if (/hiRes/i.test(c.source || "")) s += 100000;
    if (c.source === "imageBlock") s += 5000;
    if (c.source === "dom-main") s += 2000;
    return s;
  }

  /** Identity of the image currently shown as the main/landing image. */
  function liveMainId() {
    const main = document.querySelector(
      "#imgTagWrapperId img, #landingImage, #main-image-container img.a-dynamic-image, #ivLargeImage img"
    );
    if (!main) return null;
    const urls = urlsFromElement(main);
    if (!urls.length) return null;
    return imageId(bestOf(urls).url);
  }

  /**
   * Pick a trusted candidate set for the CURRENTLY selected variation.
   * The live main image is the ground truth: whichever source contains it is
   * current; the other source may hold stale images from the variation the
   * page was originally opened with, so it may only refine quality.
   */
  function trustedCandidates() {
    const block = fromImageBlock();
    const dom = fromGalleryDom();
    const mainId = liveMainId();
    if (!block.length) return dom;
    if (!dom.length || !mainId) return block;

    const blockIds = new Set();
    block.forEach(function (c) {
      (c.aliases || [c.url]).forEach(function (u) { blockIds.add(imageId(u)); });
    });

    const domIds = new Set();
    dom.forEach(function (c) {
      (c.aliases || [c.url]).forEach(function (u) { domIds.add(imageId(u)); });
    });
    const coversLiveGallery = Array.from(domIds).every(function (id) {
      return blockIds.has(id);
    });

    if (blockIds.has(mainId) && coversLiveGallery) {
      // Structured data matches the selected variation: DOM may only upgrade
      // images already present there (never introduce foreign ones).
      const filtered = dom.filter(function (c) {
        return (c.aliases || [c.url]).some(function (u) { return blockIds.has(imageId(u)); });
      });
      return block.concat(filtered);
    }
    console.debug("[Amazon Image Downloader] Rejected stale image block", {
      mainMatched: blockIds.has(mainId),
      liveGalleryCovered: coversLiveGallery,
      blockImages: blockIds.size,
      liveImages: domIds.size,
    });
    // Structured data belongs to another variation -> trust the live DOM only.
    return dom;
  }

  /** Collect + dedupe (by normalized Amazon image identity) + upgrade to highest quality. */
  function collect() {
    const candidates = trustedCandidates();
    const byId = new Map();
    const aliasToId = new Map();
    candidates.forEach(function (c) {
      const aliases = (c.aliases || [c.url]).map(imageId).filter(Boolean);
      if (!aliases.length) return;
      const original = toOriginal(c.url);
      let key = null;
      for (const alias of aliases) {
        if (aliasToId.has(alias)) {
          key = aliasToId.get(alias);
          break;
        }
      }
      if (!key) key = aliases[0];
      aliases.forEach(function (alias) { aliasToId.set(alias, key); });
      const entry = {
        id: key,
        url: original,
        thumb: c.thumb || c.url,
        ext: extensionOf(c.url),
        source: c.source,
        score: qualityScore(c),
      };
      const existing = byId.get(key);
      if (!existing || entry.score > existing.score) {
        if (existing && existing.thumb) entry.thumb = existing.thumb;
        byId.set(key, entry);
      }
    });
    return Array.from(byId.values());
  }



  window.AIDImages = { collect: collect, toOriginal: toOriginal, imageId: imageId };
})();

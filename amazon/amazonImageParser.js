/* Amazon DOM / embedded data parsing helpers.
   Exposed as window.AIDParser (no modules: MV3 content scripts share one scope). */
(function () {
  "use strict";

  const AMAZON_MEDIA_HOST = /(^|\.)(media-amazon\.com|images-amazon\.com|ssl-images-amazon\.com)$/i;

  /** True if the URL is served from Amazon's product media CDN. */
  function isAmazonMediaUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      return AMAZON_MEDIA_HOST.test(u.hostname);
    } catch (_) {
      return false;
    }
  }

  /** Product listing images live under /images/I/. Anything else is UI chrome. */
  function isListingImageUrl(url) {
    if (!isAmazonMediaUrl(url)) return false;
    try {
      const u = new URL(url, location.href);
      if (!/\/images\/I\//.test(u.pathname)) return false;
      // Amazon UI sprites/graphics live in /images/G/ or /images/S/ - excluded above.
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Detect the current page ASIN (parent or the one in the URL). */
  function getPageAsin() {
    const m = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})/i);
    if (m) return m[1].toUpperCase();
    const el =
      document.querySelector("input#ASIN, input[name='ASIN']") ||
      document.querySelector("[data-asin][data-asin!='']");
    const v = el && (el.value || el.getAttribute("data-asin"));
    if (v && /^[A-Z0-9]{10}$/i.test(v)) return v.toUpperCase();
    return null;
  }

  /** Read a top-level `var name = {...};` style object from inline scripts. */
  function readInlineJsonVar(names) {
    const scripts = Array.from(document.querySelectorAll("script:not([src])"));
    for (const s of scripts) {
      const text = s.textContent || "";
      for (const name of names) {
        const idx = text.indexOf(name);
        if (idx === -1) continue;
        const braceStart = text.indexOf("{", idx);
        if (braceStart === -1) continue;
        const json = extractBalanced(text, braceStart);
        if (!json) continue;
        const parsed = safeJsonish(json);
        if (parsed) return parsed;
      }
    }
    return null;
  }

  /** Extract a balanced {...} block starting at `start`. */
  function extractBalanced(text, start) {
    let depth = 0;
    let inStr = null;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") inStr = c;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
      if (i - start > 4_000_000) return null;
    }
    return null;
  }

  /** Parse JSON, falling back to a conservative single-quote normalisation. */
  function safeJsonish(src) {
    try {
      return JSON.parse(src);
    } catch (_) {
      /* fall through */
    }
    try {
      const normalized = src
        .replace(/([{,]\s*)'([^'\\]*)'(\s*:)/g, '$1"$2"$3')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
        .replace(/:\s*'((?:[^'\\]|\\.)*)'/g, function (_m, v) {
          return ': "' + v.replace(/"/g, '\\"') + '"';
        })
        .replace(/,(\s*[}\]])/g, "$1");
      return JSON.parse(normalized);
    } catch (_) {
      return null;
    }
  }

  /** ImageBlockATF `colorImages` / `data['colorImages']` payload. */
  function getImageBlockData() {
    const scripts = Array.from(document.querySelectorAll("script:not([src])"));
    for (const s of scripts) {
      const text = s.textContent || "";
      if (text.indexOf("colorImages") === -1) continue;

      // Modern layout: 'colorImages': { 'initial': A.$.parseJSON('[{...}]') }
      const fromLiteral = fromParseJsonLiteral(text);
      if (fromLiteral) return fromLiteral;

      const key = text.indexOf("'colorImages'") !== -1 ? "'colorImages'" : '"colorImages"';
      let idx = text.indexOf(key);
      if (idx === -1) idx = text.indexOf("colorImages");
      const braceStart = text.indexOf("{", idx);
      if (braceStart === -1) continue;
      const block = extractBalanced(text, braceStart);
      if (!block) continue;
      const parsed = safeJsonish(block);
      if (parsed && typeof parsed === "object") return parsed;
    }
    return null;
  }

  /** Pull the image array out of `A.$.parseJSON('[...]')` after `colorImages`. */
  function fromParseJsonLiteral(text) {
    const start = text.indexOf("colorImages");
    if (start === -1) return null;
    const needle = "parseJSON(";
    let cursor = start;
    for (let guard = 0; guard < 20; guard++) {
      const at = text.indexOf(needle, cursor);
      if (at === -1) return null;
      cursor = at + needle.length;
      const quote = text[cursor];
      if (quote !== "'" && quote !== '"') continue;
      let end = cursor + 1;
      while (end < text.length) {
        const c = text[end];
        if (c === "\\") {
          end += 2;
          continue;
        }
        if (c === quote) break;
        end++;
      }
      let raw = text.slice(cursor + 1, end);
      if (quote === "'") raw = raw.replace(/\\'/g, "'");
      else raw = raw.replace(/\\"/g, '"');
      let arr = null;
      try {
        arr = JSON.parse(raw);
      } catch (_) {
        arr = null;
      }
      if (
        Array.isArray(arr) &&
        arr.length &&
        arr.some(function (item) {
          return item && (item.hiRes || item.large || item.thumb);
        })
      ) {
        return { initial: arr };
      }
      cursor = end + 1;
    }
    return null;
  }


  /** twister/dimension state from `dataToReturn` or `twisterController`. */
  function getTwisterData() {
    return readInlineJsonVar(["dataToReturn = ", "var dataToReturn", "twisterData ="]);
  }

  window.AIDParser = {
    isAmazonMediaUrl,
    isListingImageUrl,
    getPageAsin,
    getImageBlockData,
    getTwisterData,
    readInlineJsonVar,
    extractBalanced,
    safeJsonish,
  };
})();

/* global window */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  const DEBUG = true;
  function log(tag, obj) {
    if (!DEBUG) return;
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, obj);
  }

  function txt(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isFillable(el) {
    if (!el || !isVisible(el)) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    if (el.closest("[hidden], [aria-hidden='true'], template")) return false;
    return true;
  }

  function accessibleName(el) {
    if (!el) return "";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(txt);
      if (parts.length) return parts.join(" ").trim();
    }
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return txt(lbl);
    }
    const wrapping = el.closest("label");
    if (wrapping) return txt(wrapping);
    return "";
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 4000, interval = 150 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      try {
        const v = await fn();
        if (v) return v;
      } catch {
        /* keep polling */
      }
      if (Date.now() > end) return null;
      await sleep(interval);
    }
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /** Native value setter so React/other controlled inputs actually register the change. */
  function setNativeInputValue(input, value) {
    const proto =
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    input.focus();
    if (descriptor && descriptor.set) descriptor.set.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    input.blur();
  }

  /** Section discovery: heading text -> nearest container that also holds form controls. */
  function findSectionByHeading(patterns, { root = document, requireControls = true } = {}) {
    const rx = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p, "i")));
    const headings = Array.from(
      root.querySelectorAll("h1,h2,h3,h4,h5,legend,[role='heading'],[class*='title'],[class*='heading']"),
    );
    const candidates = [];
    for (const h of headings) {
      const t = txt(h);
      if (!t || t.length > 80) continue;
      if (!rx.some((r) => r.test(t))) continue;
      if (!isVisible(h)) continue;
      let node = h;
      for (let depth = 0; depth < 8 && node; depth += 1) {
        node = node.parentElement;
        if (!node) break;
        const hasControls = node.querySelector("input,textarea,select,[contenteditable='true'],iframe");
        if (!requireControls || hasControls) {
          candidates.push({ section: node, heading: t, depth });
          break;
        }
      }
    }
    candidates.sort((a, b) => a.depth - b.depth);
    return candidates[0] || null;
  }

  /** Within a confirmed section, find the control whose label/accessible name matches. */
  function findFieldWithinSection(section, patterns, { types = null } = {}) {
    if (!section) return null;
    const rx = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p, "i")));
    const controls = Array.from(section.querySelectorAll("input,textarea,select"));
    const scored = [];
    for (const c of controls) {
      if (types && !types.includes((c.type || "text").toLowerCase()) && c.tagName !== "TEXTAREA") continue;
      if (!isFillable(c)) continue;
      const names = [accessibleName(c), c.name || "", c.id || "", c.getAttribute("placeholder") || ""];
      const labelledText = names.join(" ");
      let score = 0;
      rx.forEach((r) => {
        if (r.test(accessibleName(c))) score += 3;
        else if (r.test(labelledText)) score += 1;
      });
      if (score > 0) scored.push({ el: c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].el : null;
  }

  Object.assign(AEB, {
    log,
    txt,
    isVisible,
    isFillable,
    accessibleName,
    escapeHTML,
    sleep,
    waitFor,
    debounce,
    setNativeInputValue,
    findSectionByHeading,
    findFieldWithinSection,
  });
})();

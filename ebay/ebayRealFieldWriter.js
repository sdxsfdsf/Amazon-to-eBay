/* global window, CSS, HTMLTextAreaElement, HTMLSelectElement, HTMLInputElement, InputEvent, FocusEvent, KeyboardEvent */
/*
 * Real, section-scoped writes into eBay's own listing controls (React-safe),
 * imported from amazon-ebay-assistant 1.7 and adapted to the v2.4 AEB namespace.
 *
 * Hard guarantees:
 *   - Item Price is written ONLY to a control whose own label is exactly
 *     "Item price", located INSIDE the confirmed PRICING section.
 *   - Quantity is written ONLY to a control whose own label is exactly
 *     "Quantity", located INSIDE the confirmed PRICING section.
 *   - There is NO similarly-named fallback anywhere. If the exact field is not
 *     found inside PRICING, the write is abandoned and a failure code returned.
 *   - Description is written ONLY inside a section whose heading text is exactly
 *     "Description" as a standalone heading. Longer labels such as
 *     "Conditional Description", "Product Description" and "Description Settings"
 *     are rejected outright.
 *   - Every write is verified by re-reading eBay's own control after a rerender,
 *     then the control is released so the user can still edit it by hand.
 *   - No overlays, no placeholders, no fabricated success.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  const clean = (s) =>
    (s == null ? "" : String(s))
      .replace(/\u200e|\u200f|\u00ad/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const text = (el) => (el ? clean(el.textContent) : "");
  const qa = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const log = (...a) => console.log("[EBAY REAL WRITE]", ...a);
  const dlog = (...a) => console.log("[EBAY DESCRIPTION]", ...a);

  const normVal = (v) => clean(String(v == null ? "" : v)).toLowerCase();
  const normNum = (v) => {
    const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : null;
  };

  function visible(node) {
    if (!node || !node.isConnected) return false;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const st = getComputedStyle(node);
    return st.visibility !== "hidden" && st.display !== "none";
  }

  function labelText(input) {
    const bits = [];
    const aria = input.getAttribute("aria-label");
    if (aria) bits.push(aria);
    const lb = input.getAttribute("aria-labelledby");
    if (lb)
      lb.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) bits.push(text(n));
      });
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l) bits.push(text(l));
    }
    const wrap = input.closest("label");
    if (wrap) bits.push(text(wrap));
    bits.push(
      input.getAttribute("name") || "",
      input.getAttribute("id") || "",
      input.getAttribute("placeholder") || "",
    );
    return clean(bits.join(" "));
  }

  /* ------------------------------------------------------------------ *
   * Section location
   * ------------------------------------------------------------------ */

  const HEADING_SEL =
    "h1, h2, h3, h4, h5, h6, legend, [role='heading'], .summary__title, [class*='title'], [class*='heading']";

  function headingsMatching(re) {
    return qa(HEADING_SEL).filter((h) => re.test(clean(text(h))));
  }

  function containsHeading(node, re) {
    return qa(HEADING_SEL, node).some((h) => re.test(clean(text(h))));
  }

  const PRICING_RE = /^pricing$/i;
  const SHIPPING_RE = /^shipping( details)?$/i;

  /**
   * STRICT standalone "Description" heading.
   * Matches only the single word "Description", optionally followed by a bare
   * required/decoration marker (* or :). Anything with an extra word fails:
   *   "Description"            -> accepted
   *   "Description *"          -> accepted (eBay's required marker)
   *   "Conditional Description"-> REJECTED
   *   "Product Description"    -> REJECTED
   *   "Description Settings"   -> REJECTED
   *   "Item description"       -> REJECTED (not standalone "Description")
   */
  const EXACT_DESCRIPTION_HEADING_RE = /^description\s*[:*]?$/i;

  /** Any heading that clearly belongs to a DIFFERENT section — used as a boundary. */
  const FOREIGN_SECTION_RE = /^(pricing|shipping( details)?|photos?( and video)?|pictures?|item specifics|condition|title|category|selling details|preferences)\s*[:*]?$/i;

  /** True only for a heading element whose own text is exactly "Description". */
  function isExactDescriptionHeading(h) {
    return EXACT_DESCRIPTION_HEADING_RE.test(clean(text(h)));
  }

  /** The confirmed PRICING container: starts at the PRICING heading, ends before SHIPPING/DESCRIPTION. */
  function findPricingContainer() {
    const headings = headingsMatching(PRICING_RE);
    for (const heading of headings) {
      let node = heading.parentElement;
      let best = null;
      while (node && node !== document.body) {
        if (containsHeading(node, SHIPPING_RE) || containsHeading(node, EXACT_DESCRIPTION_HEADING_RE)) break;
        if (qa("input, select", node).some(visible)) best = node;
        node = node.parentElement;
      }
      if (best && visible(best)) {
        log("Pricing section located");
        return best;
      }
    }
    log("Pricing section NOT found");
    return null;
  }

  /**
   * The control's OWN label must equal the pattern. Attribute soup (name/id/
   * placeholder) is deliberately NOT consulted here — that is what allows a
   * "Shipping price" or "Recommended price" field to masquerade as Item price.
   */
  function exactLabelMatch(input, re) {
    const bits = [];
    const aria = input.getAttribute("aria-label");
    if (aria) bits.push(aria);
    const lb = input.getAttribute("aria-labelledby");
    if (lb)
      lb.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) bits.push(text(n));
      });
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l) bits.push(text(l));
    }
    const wrap = input.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true);
      qa("input, select, textarea", clone).forEach((n) => n.remove());
      bits.push(text(clone));
    }
    return bits.map((b) => clean(b)).some((b) => re.test(b));
  }

  function writableIn(container, el) {
    return !!(
      el &&
      el.isConnected &&
      container &&
      container.isConnected &&
      container.contains(el) &&
      visible(el) &&
      !el.disabled &&
      !el.readOnly &&
      el.getAttribute("aria-disabled") !== "true" &&
      (el.tagName === "SELECT" || (el.getAttribute("type") || "text").toLowerCase() !== "hidden")
    );
  }

  /** Returns { container, element } or { error }. NO fallback outside PRICING. */
  function locateInPricing(kind) {
    const container = findPricingContainer();
    if (!container) return { error: "PRICING_SECTION_NOT_FOUND" };
    const re = kind === "price" ? /^item price\*?$/i : /^quantity\*?$/i;
    const sel = kind === "price" ? "input" : "input, select";
    const element = qa(sel, container).find((el) => writableIn(container, el) && exactLabelMatch(el, re));
    if (!element) {
      return {
        error: kind === "price" ? "ITEM_PRICE_FIELD_NOT_FOUND" : "QUANTITY_FIELD_NOT_FOUND",
        container,
      };
    }
    if (!container.contains(element)) return { error: "TARGET_OUTSIDE_PRICING_SECTION", container };
    log(kind === "price" ? "Item price input detected" : "Quantity input detected");
    return { container, element };
  }

  const findRealPriceInput = () => locateInPricing("price").element || null;
  const findRealQuantityInput = () => locateInPricing("quantity").element || null;

  /* ------------------------------------------------------------------ *
   * Description: strict section + editor detection
   * ------------------------------------------------------------------ */

  /** querySelectorAll that also walks open shadow roots. */
  function deepQueryAll(selector, rootEl) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      try {
        out.push(...Array.from(node.querySelectorAll(selector)));
      } catch {
        /* ignore */
      }
      const all = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const child of all) if (child.shadowRoot) walk(child.shadowRoot);
    };
    walk(rootEl || document);
    return out;
  }

  const EDITOR_SELECTOR = "textarea, iframe, [contenteditable='true'], [contenteditable=''], [role='textbox']";

  /**
   * Locate the Description section by EXACT standalone heading only.
   * Returns { section, heading } or { error: "DESCRIPTION_HEADER_NOT_FOUND" }.
   *
   * Deliberately does NOT look at class names, ids, data-testid or aria-label,
   * because those routinely contain the substring "description" on unrelated
   * containers (e.g. a "conditional-description" wrapper).
   */
  function findDescriptionSectionStrict() {
    const exact = qa(HEADING_SEL).filter((h) => isExactDescriptionHeading(h) && visible(h));
    if (!exact.length) {
      dlog("Exact standalone 'Description' heading found: false — refusing to write anywhere");
      return { error: "DESCRIPTION_HEADER_NOT_FOUND" };
    }
    for (const heading of exact) {
      let node = heading.parentElement;
      let best = null;
      while (node && node !== document.body) {
        // Stop before the candidate swallows a different top-level section.
        const foreign = qa(HEADING_SEL, node).some(
          (h) => h !== heading && FOREIGN_SECTION_RE.test(clean(text(h))),
        );
        if (foreign) break;
        if (deepQueryAll(EDITOR_SELECTOR, node).length > 0) {
          best = node;
          break;
        }
        node = node.parentElement;
      }
      if (best) {
        dlog("Exact standalone 'Description' heading found: true");
        return { section: best, heading };
      }
    }
    dlog("Exact standalone 'Description' heading found, but it owns no editor");
    return { error: "DESCRIPTION_EDITOR_NOT_FOUND" };
  }

  function editorFromNodes(nodes) {
    const iframe = nodes.find((f) => {
      if (f.tagName !== "IFRAME" || !visible(f)) return false;
      try {
        return !!(f.contentDocument && f.contentDocument.body);
      } catch {
        return false;
      }
    });
    if (iframe) return { kind: "iframe", element: iframe };

    const ce = nodes
      .filter(
        (n) =>
          n.tagName !== "IFRAME" &&
          n.tagName !== "TEXTAREA" &&
          visible(n) &&
          (n.isContentEditable ||
            n.getAttribute("contenteditable") === "true" ||
            n.getAttribute("contenteditable") === ""),
      )
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (ce) return { kind: "contenteditable", element: ce };

    const ta = nodes.filter((n) => n.tagName === "TEXTAREA");
    const visibleTa = ta.find(visible) || ta[0];
    if (visibleTa) return { kind: "textarea", element: visibleTa };

    const box = nodes.find((n) => n.getAttribute && n.getAttribute("role") === "textbox" && visible(n));
    if (box) return { kind: "contenteditable", element: box };
    return null;
  }

  function backingTextarea(scope, exclude) {
    if (!scope) return null;
    return (
      deepQueryAll("textarea", scope).find((t) => t !== exclude && (/desc/i.test(labelText(t)) || !visible(t))) ||
      null
    );
  }

  /**
   * Returns { kind, element, backing, section } or { error }.
   * Scoped strictly to the exact-"Description" section — there is no
   * document-wide fallback, so a wrong section can never be written into.
   */
  function findRealEbayDescriptionEditor() {
    const located = findDescriptionSectionStrict();
    if (located.error) return { error: located.error };
    const found = editorFromNodes(deepQueryAll(EDITOR_SELECTOR, located.section));
    if (!found) return { error: "DESCRIPTION_EDITOR_NOT_FOUND" };
    found.backing = backingTextarea(located.section, found.element);
    found.section = located.section;
    dlog("Editor type:", found.kind);
    return found;
  }

  /** Clicks eBay's own control that reveals the editor — only inside the exact section. */
  async function activateDescriptionEditor() {
    const located = findDescriptionSectionStrict();
    if (located.error) return false;
    const controls = deepQueryAll("button, a[role='button'], [role='button'], a", located.section).filter(visible);
    const hit = controls.find((c) => {
      const t = clean(c.textContent + " " + (c.getAttribute("aria-label") || "")).toLowerCase();
      return /^(add|edit|write|create|show)?\s*(a\s*)?(description|item description)/.test(t) && t.length < 60;
    });
    if (!hit) {
      dlog("Activation control found: false");
      return false;
    }
    dlog("Activation control found: true");
    try {
      hit.click();
    } catch {
      /* ignore */
    }
    await sleep(600);
    return true;
  }

  async function waitForDescriptionEditor(timeout) {
    const start = Date.now();
    let activated = false;
    let lastError = "DESCRIPTION_EDITOR_NOT_FOUND";
    while (Date.now() - start < (timeout || 8000)) {
      const editor = findRealEbayDescriptionEditor();
      if (!editor.error) return editor;
      lastError = editor.error;
      // A missing exact header is terminal — never keep hunting for a looser match.
      if (lastError === "DESCRIPTION_HEADER_NOT_FOUND") return { error: lastError };
      if (!activated) activated = await activateDescriptionEditor();
      await sleep(250);
    }
    return { error: lastError };
  }

  /* ------------------------------------------------------------------ *
   * Writers
   * ------------------------------------------------------------------ */

  function setNativeValue(element, value) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  async function setRealInputValue(element, value) {
    const str = String(value);
    try {
      element.focus();
      element.click();
      if (element.select) element.select();
    } catch {
      /* focus can be blocked; continue */
    }
    if (element.tagName === "SELECT") {
      const opt = qa("option", element).find(
        (o) => normVal(o.value) === normVal(str) || normVal(o.textContent) === normVal(str),
      );
      if (!opt) return false;
      setNativeValue(element, opt.value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      return true;
    }
    // clear first so controlled inputs register a real transition
    element.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }),
    );
    setNativeValue(element, "");
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    await sleep(20);
    element.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: str }),
    );
    setNativeValue(element, str);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: str }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Tab" }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    try {
      element.blur();
    } catch {
      /* ignore */
    }
    return true;
  }

  async function setRealDescriptionHtml(editor, html, plain) {
    if (!editor || editor.error) return false;
    const { kind, element } = editor;

    if (kind === "iframe") {
      try {
        const doc = element.contentDocument || (element.contentWindow && element.contentWindow.document);
        const body = doc && doc.body;
        if (!body) return false;
        const win = element.contentWindow;
        try {
          body.focus();
          const sel = win.getSelection();
          const range = doc.createRange();
          range.selectNodeContents(body);
          sel.removeAllRanges();
          sel.addRange(range);
          if (!(doc.execCommand && doc.execCommand("insertHTML", false, html))) body.innerHTML = html;
          sel.removeAllRanges();
        } catch {
          body.innerHTML = html;
        }
        body.dispatchEvent(new win.Event("input", { bubbles: true }));
        body.dispatchEvent(new win.Event("change", { bubbles: true }));
        doc.dispatchEvent(new win.Event("selectionchange", { bubbles: true }));
        body.dispatchEvent(new win.FocusEvent("blur", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        dlog("Failure reason: iframe write threw —", e.message);
        return false;
      }
    } else if (kind === "contenteditable") {
      try {
        element.click();
      } catch {
        /* ignore */
      }
      element.focus();
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        sel.removeAllRanges();
        sel.addRange(range);
        element.dispatchEvent(
          new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromPaste" }),
        );
        const inserted = document.execCommand && document.execCommand("insertHTML", false, html);
        if (!inserted || !clean(element.innerHTML)) element.innerHTML = html;
        sel.removeAllRanges();
      } catch {
        element.innerHTML = html;
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      try {
        element.blur();
      } catch {
        /* ignore */
      }
    } else {
      // Textareas in eBay's description section hold the raw HTML source.
      const acceptsHtml = !/plain/i.test(labelText(element));
      await setRealInputValue(element, acceptsHtml ? html : plain || html);
    }

    // Keep any hidden backing textarea in sync so eBay saves the real HTML.
    if (editor.backing && editor.backing !== element) {
      await setRealInputValue(editor.backing, html);
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Verification
   * ------------------------------------------------------------------ */

  function readDescription(editor) {
    if (!editor || !editor.element || !editor.element.isConnected) return "";
    if (editor.kind === "iframe") {
      try {
        return (editor.element.contentDocument && editor.element.contentDocument.body.innerHTML) || "";
      } catch {
        return "";
      }
    }
    if (editor.kind === "contenteditable") return editor.element.innerHTML || "";
    return editor.element.value || "";
  }

  function descriptionMatches(actual, expected) {
    if (!actual) return false;
    const a = clean(actual.replace(/<[^>]+>/g, " ")).toLowerCase();
    const e = clean(expected.replace(/<[^>]+>/g, " ")).toLowerCase();
    if (!e) return false;
    const markers = ["product details", "about this item"].filter((m) => e.includes(m));
    if (markers.length && !markers.every((m) => a.includes(m))) return false;
    const head = e.slice(0, 60);
    return a.includes(head) || a.length >= Math.min(e.length * 0.6, 400);
  }

  /** Post-write confirmation that the user can still type into the control. */
  function isStillEditable(target) {
    const node = target && (target.element || target);
    if (!node || !node.isConnected) return false;
    if (node.tagName === "IFRAME") {
      try {
        const body = node.contentDocument && node.contentDocument.body;
        return !!body && body.getAttribute("contenteditable") !== "false";
      } catch {
        return false;
      }
    }
    if (node.getAttribute && node.getAttribute("contenteditable") !== null) {
      return node.getAttribute("contenteditable") !== "false";
    }
    return !node.disabled && !node.readOnly && node.getAttribute("aria-disabled") !== "true";
  }

  /* ------------------------------------------------------------------ *
   * Release control after a verified write
   * ------------------------------------------------------------------ */

  /** Hands the field back to the user: no locks, no lingering selection, no further writes. */
  function releaseControl(target) {
    const nodes = [];
    if (!target) return;
    if (target.element) {
      nodes.push(target.element);
      if (target.backing) nodes.push(target.backing);
    } else nodes.push(target);

    for (const node of nodes) {
      if (!node || !node.isConnected) continue;
      try {
        if (node.readOnly) node.readOnly = false;
        if (node.disabled) node.disabled = false;
        node.removeAttribute && node.removeAttribute("readonly");
        node.removeAttribute && node.removeAttribute("disabled");
        if (node.getAttribute && node.getAttribute("aria-disabled") === "true")
          node.removeAttribute("aria-disabled");
        if (node.getAttribute && node.getAttribute("contenteditable") === "false")
          node.setAttribute("contenteditable", "true");
        if (node.tagName === "IFRAME") {
          const doc = node.contentDocument;
          const body = doc && doc.body;
          if (body && body.getAttribute("contenteditable") === "false")
            body.setAttribute("contenteditable", "true");
          try {
            node.contentWindow.getSelection().removeAllRanges();
          } catch {
            /* ignore */
          }
        }
        if (typeof node.blur === "function") node.blur();
      } catch {
        /* ignore */
      }
    }
    try {
      window.getSelection().removeAllRanges();
    } catch {
      /* ignore */
    }
    log("Control released — field is manually editable");
  }

  async function waitForEbayStateUpdate(ms) {
    await sleep(ms || 260);
    await new Promise((r) => requestAnimationFrame(() => r()));
  }

  /* ------------------------------------------------------------------ *
   * Public write operations
   * ------------------------------------------------------------------ */

  /** Strict, section-scoped write: re-acquire PRICING + exact field on every attempt. */
  async function writeScopedPricingField({ kind, label, value, compare, notPersisted }) {
    let lastError = kind === "price" ? "ITEM_PRICE_FIELD_NOT_FOUND" : "QUANTITY_FIELD_NOT_FOUND";
    let lastActual = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const found = locateInPricing(kind);
      if (found.error) {
        lastError = found.error;
        log(`${label} attempt ${attempt} aborted:`, found.error);
        await sleep(250);
        continue;
      }
      // double verify immediately before writing
      if (!writableIn(found.container, found.element)) {
        lastError = "TARGET_OUTSIDE_PRICING_SECTION";
        await sleep(250);
        continue;
      }
      log(`${label} write attempted (attempt ${attempt})`);
      await setRealInputValue(found.element, value);
      await waitForEbayStateUpdate(300 + attempt * 250);

      // re-acquire after rerender and verify the real value
      const after = locateInPricing(kind);
      if (after.error) {
        lastError = after.error;
        continue;
      }
      lastActual = after.element.value;
      if (compare(lastActual, value)) {
        releaseControl(after.element);
        const editable = isStillEditable(after.element);
        log(`${label} verified:`, lastActual, "| still editable:", editable);
        return { ok: true, actual: lastActual, editable };
      }
      log(`${label} verification failed — expected:`, value, "actual:", lastActual);
      lastError = notPersisted;
    }
    return { ok: false, actual: lastActual, reason: lastError, code: lastError };
  }

  async function writeRealPrice(price) {
    return writeScopedPricingField({
      kind: "price",
      label: "Item price",
      value: Number(price).toFixed(2),
      compare: (a, e) => normNum(a) !== null && Math.abs(normNum(a) - Number(e)) < 0.005,
      notPersisted: "PRICE_NOT_PERSISTED",
    });
  }

  async function writeRealQuantity(qty) {
    return writeScopedPricingField({
      kind: "quantity",
      label: "Quantity",
      value: String(qty),
      compare: (a, e) => normNum(a) !== null && normNum(a) === Number(e),
      notPersisted: "QUANTITY_NOT_PERSISTED",
    });
  }

  async function writeRealDescription(html, plain) {
    dlog("Starting autofill");
    dlog("Generated HTML length:", (html || "").length);

    // Gate 1: the exact standalone "Description" header must exist.
    const located = findDescriptionSectionStrict();
    if (located.error === "DESCRIPTION_HEADER_NOT_FOUND") {
      dlog("Verification: failed");
      dlog("Failure reason: no exact standalone 'Description' header — nothing was written");
      return { ok: false, actual: "", code: "DESCRIPTION_HEADER_NOT_FOUND", reason: "no exact Description header" };
    }

    let editor = await waitForDescriptionEditor(8000);
    if (editor.error) {
      dlog("Verification: failed");
      dlog("Failure reason:", editor.error);
      return { ok: false, actual: "", code: editor.error, reason: editor.error };
    }

    let lastActual = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      dlog("Write attempt:", attempt);
      if (!editor || editor.error || !editor.element || !editor.element.isConnected) {
        editor = await waitForDescriptionEditor(3000);
        if (editor.error) break;
      }
      await setRealDescriptionHtml(editor, html, plain);
      await waitForEbayStateUpdate(500 + attempt * 200);
      if (!editor.element.isConnected) {
        const re = findRealEbayDescriptionEditor();
        if (!re.error) editor = re;
      }
      lastActual = readDescription(editor);
      dlog("Post-write content length:", (lastActual || "").length);
      if (descriptionMatches(lastActual, html)) {
        releaseControl(editor);
        const editable = isStillEditable(editor);
        dlog("Verification: success | still editable:", editable);
        return { ok: true, actual: lastActual, editable };
      }
      dlog("Verification: failed");
      dlog("Failure reason: editor content did not retain the generated HTML");
      await sleep(300);
    }
    return {
      ok: false,
      actual: lastActual,
      code: "DESCRIPTION_NOT_PERSISTED",
      reason: "write not accepted",
    };
  }

  AEB.ebayRealFieldWriter = {
    // section / field locators
    findPricingContainer,
    locateInPricing,
    findRealPriceInput,
    findRealQuantityInput,
    findDescriptionSectionStrict,
    findRealEbayDescriptionEditor,
    isExactDescriptionHeading,
    activateDescriptionEditor,
    waitForDescriptionEditor,
    // primitives
    deepQueryAll,
    setNativeValue,
    setRealInputValue,
    setRealDescriptionHtml,
    releaseControl,
    readDescription,
    descriptionMatches,
    isStillEditable,
    // verified writes
    writeRealPrice,
    writeRealQuantity,
    writeRealDescription,
    // exposed for tests
    EXACT_DESCRIPTION_HEADING_RE,
  };
})();

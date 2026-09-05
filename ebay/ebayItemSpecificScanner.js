/* global window, Node, MutationObserver */
/* Region + ordered-boundary detection of eBay Suggested Item Specifics and Required fields.

   NEW ARCHITECTURE (v2):
   - In-memory snapshot of latest scan result
   - Debounced MutationObserver to invalidate snapshot on DOM changes
   - Generation tracking to prevent stale scan races
   - Snapshot used immediately by Prompt (no 4-6s blocking scan)
   - Bounded refresh only if snapshot is stale
   - Prevents expected-but-unresolved trap from causing repeated long delays

   EXTRACTED LOGIC (unchanged):
     1. Locate the Item Specifics / Item Details region (fallback: document.body).
     2. Locate the "Additional (optional)" node inside that region — it is an ORDERED END MARKER.
     3. Collect every candidate field (native OR custom control) whose DOM position is BEFORE
        that marker. A shared ancestor that also contains Additional never invalidates a field.
     4. Classify each candidate as Suggested / Required through multiple signals.
*/
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { txt, isVisible, accessibleName, sleep, log, debounce } = AEB;

  // ============================================================================
  // SNAPSHOT STATE MANAGEMENT
  // ============================================================================

  let generation = 0;
  let snapshot = null;
  let snapshotGenerationId = null;
  let snapshotTimestamp = null;
  let observedRegionElement = null;
  let mutationObserverInstance = null;
  let pendingRefreshGenerationId = null;
  let activeRefreshPromise = null;
  let lastGoodRequired = []; // Preserve during transient rerenders

  // In-memory cache, page-session only (not persisted)
  function currentSnapshot() {
    return snapshot;
  }

  function isSnapshotValid() {
    return (
      snapshot &&
      snapshotGenerationId === generation &&
      snapshotTimestamp &&
      Date.now() - snapshotTimestamp < 10000 && // Snapshots valid for 10 seconds
      snapshot.requiredResolved !== false // CRITICAL: Must be resolved (or no Required expected)
    );
  }

  function isSnapshotRecent() {
    return (
      snapshot &&
      snapshotGenerationId === generation &&
      snapshotTimestamp &&
      Date.now() - snapshotTimestamp < 500 // "Fresh" = within 500ms
    );
  }

  function invalidateSnapshot() {
    // Mark current snapshot as stale, but don't clear it yet
    // (stale snapshot can still be used if refresh is bounded)
    snapshotGenerationId = -1; // Sentinel: invalidated but not empty
  }

  function updateSnapshot(result) {
    // Only update if this generation is still current
    // (prevents old async scans from overwriting newer DOM state)
    if (pendingRefreshGenerationId && pendingRefreshGenerationId !== generation) {
      return false; // Discarded: newer generation exists
    }

    // Ensure requiredResolved flag is set (NEW)
    if (!result.hasOwnProperty('requiredResolved')) {
      result.requiredResolved = false;
    }

    // If this scan has Required resolved and found fields, save as last good
    if (result.requiredResolved && result.required && result.required.length > 0) {
      lastGoodRequired = result.required;
    }

    // If this scan has Required unresolved but we have a last good value,
    // preserve it ONLY if we're in the same context (same Suggested)
    if (!result.requiredResolved && lastGoodRequired.length > 0 && snapshot && shouldPreservePreviousRequired(result)) {
      result.required = lastGoodRequired;
      if (log) log("Required: preserving last good value during transient rerender");
    }

    snapshot = result;
    snapshotGenerationId = generation;
    snapshotTimestamp = Date.now();
    return true;
  }

  /**
   * Determine if we should preserve previous Required data.
   * Don't preserve if context changed (different listing/category/Suggested section).
   */
  function shouldPreservePreviousRequired(currentResult) {
    if (!snapshot) return false;

    // If Suggested context changed, don't preserve old Required
    if (snapshot.suggestedExpected !== currentResult.suggestedExpected) return false;
    if ((snapshot.suggested || []).length !== (currentResult.suggested || []).length) return false;
    if (
      snapshot.suggested &&
      currentResult.suggested &&
      snapshot.suggested.join("|") !== currentResult.suggested.join("|")
    ) {
      return false;
    }

    // Same Suggested context, so preserve last Required during transient rerender
    return true;
  }

  // ============================================================================
  // EXPECTED-BUT-UNRESOLVED DETECTION
  // ============================================================================

  /**
   * Detects if result is stuck in expected-but-unresolved state.
   * This is different from "still loading" — it's a structural incompatibility.
   */
  function isExpectedButUnresolved(result) {
    return (
      (result.suggestedExpected && !result.suggested.length) ||
      (result.requiredExpected && !result.required.length)
    );
  }

  /**
   * If the same unresolved structure repeats without mutation, stop treating it as "loading".
   * Return a marked result that distinguishes "stale unresolved" from "actively loading".
   */
  function markStaleUnresolvedIfApplicable(current, previous) {
    // If both are unresolved in the same way
    if (
      isExpectedButUnresolved(current) &&
      isExpectedButUnresolved(previous) &&
      current.suggested.join("|") === previous.suggested.join("|") &&
      current.required.join("|") === previous.required.join("|")
    ) {
      // The structure hasn't changed and still unresolved = stale, not loading
      return {
        ...current,
        staleUnresolved: true, // Mark this result as "structure incompatibility, not loading"
      };
    }
    return current;
  }

  // ============================================================================
  // MUTATION OBSERVER: AUTO-INVALIDATE ON DOM CHANGE
  // ============================================================================

  function observeItemSpecificsRegion() {
    // Only set up observer once
    if (mutationObserverInstance) return;

    if (!MutationObserver) return;

    // Debounced invalidation: mutations within 300ms window are batched
    const debouncedInvalidate = debounce(() => {
      if (log) log("eBay Item Specifics DOM changed — snapshot invalidated");
      invalidateSnapshot();
      // Trigger a pending refresh with new generation
      generation += 1;
      pendingRefreshGenerationId = generation;
    }, 300);

    mutationObserverInstance = new MutationObserver((mutations) => {
      // Check if observed region is still connected (handles region replacement)
      if (observedRegionElement && !observedRegionElement.isConnected) {
        // Region was replaced/removed - rebind observer
        if (log) log("Item Specifics region disconnected — rebinding observer");
        rebindObserver(debouncedInvalidate);
        invalidateSnapshot();
        generation += 1;
        pendingRefreshGenerationId = generation;
        return;
      }

      // Quickly check if any mutation affects Item Specifics area
      const affectsRegion = mutations.some((m) => {
        if (m.type === "childList") return true;
        if (m.type === "attributes" && m.attributeName === "class") return true;
        if (m.type === "attributes" && m.attributeName === "aria-hidden") return true;
        if (m.type === "attributes" && m.attributeName === "hidden") return true;
        if (m.type === "attributes" && m.attributeName === "style") return true;
        return false;
      });

      if (affectsRegion) {
        debouncedInvalidate();
      }
    });

    // Attempt to observe just the Item Specifics region if we can find it
    const region = findItemSpecificsRegion();
    if (region && region.isConnected) {
      observedRegionElement = region;
      mutationObserverInstance.observe(region, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-hidden", "hidden", "style"],
      });
    } else {
      // Fallback: observe body for more general changes
      mutationObserverInstance.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-hidden", "hidden", "style"],
      });
    }
  }

  /**
   * Rebind observer to new Item Specifics region if old one was replaced/disconnected.
   * This handles eBay replacing the entire Item Specifics section during rerender.
   */
  function rebindObserver(debouncedInvalidate) {
    if (!mutationObserverInstance) return;

    // Disconnect from old region
    mutationObserverInstance.disconnect();

    // Find new region
    const newRegion = findItemSpecificsRegion();
    if (newRegion && newRegion !== observedRegionElement && newRegion.isConnected) {
      observedRegionElement = newRegion;
      mutationObserverInstance.observe(newRegion, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-hidden", "hidden", "style"],
      });
      if (log) log("Observer rebound to new Item Specifics region");
    } else {
      // Fall back to observing body if new region not found
      mutationObserverInstance.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-hidden", "hidden", "style"],
      });
    }
  }

  // ============================================================================
  // EXTRACTION LOGIC (UNCHANGED)
  // ============================================================================

  /** Tolerates capitalization, whitespace, non-breaking spaces and minor punctuation differences. */
  function normalize(value) {
    return String(value ?? "")
      .replace(/[\u00a0\u2007\u202f\u200e\u200f]/g, " ")
      .replace(/[()[\]{}:.,;–—-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  const ADDITIONAL_RX = /^additional(\s+(optional|item\s+specifics|details|specifics))?$/;
  const SUGGESTED_RX = [
    /^suggested item specifics$/,
    /^suggested$/,
    /^recommended$/,
    /^recommended item specifics$/,
    /^suggested item details$/,
  ];
  const REQUIRED_RX = [/^required$/, /^required item details$/, /^required item specifics$/];
  const REGION_RX = [/^item specifics$/, /^item details$/, /^item specifics and details$/, /^specifics$/];

  const HEADING_SELECTOR =
    "h1,h2,h3,h4,h5,h6,legend,summary,[role='heading'],[class*='title'],[class*='heading'],[class*='label'],span,div,p,strong,b";

  const CONTROL_SELECTOR = [
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[role='combobox']",
    "[role='textbox']",
    "[role='listbox']",
    "[role='spinbutton']",
    "[contenteditable='true']",
    "button[aria-haspopup]",
    "button[aria-expanded]",
    "[aria-required='true']",
  ].join(",");

  function headingCandidates(root) {
    return Array.from((root || document).querySelectorAll(HEADING_SELECTOR)).filter((el) => {
      const t = txt(el);
      return t && t.length <= 60;
    });
  }

  /** Deepest node whose own text is the heading (not a wrapper that merely contains it). */
  function deepestMatch(nodes) {
    let best = null;
    nodes.forEach((el) => {
      if (!best) best = el;
      else if (best.contains(el)) best = el;
    });
    return best;
  }

  /** The Item Specifics region: heading-derived container, else document.body. */
  function findItemSpecificsRegion() {
    const heading = deepestMatch(
      headingCandidates(document).filter((el) => REGION_RX.some((r) => r.test(normalize(txt(el))))),
    );
    if (heading) {
      let node = heading;
      for (let depth = 0; depth < 8 && node; depth += 1) {
        node = node.parentElement;
        if (!node) break;
        if (node.querySelector(CONTROL_SELECTOR)) return node;
      }
    }
    return document.body;
  }

  /** SIGNAL 1 — the "Additional (optional)" ordered END marker (never a parent-rejection rule). */
  function findAdditionalBoundary(region) {
    const scope = region && region.isConnected ? region : document;
    const inScope = deepestMatch(
      headingCandidates(scope).filter((el) => ADDITIONAL_RX.test(normalize(txt(el)))),
    );
    if (inScope) return inScope;
    return deepestMatch(headingCandidates(document).filter((el) => ADDITIONAL_RX.test(normalize(txt(el)))));
  }

  /** Strict DOM-order comparison for FIELD-level nodes only. */
  function isBeforeBoundary(el, boundary) {
    if (!boundary || !el) return true;
    if (el === boundary || el.contains(boundary) || boundary.contains(el)) return false;
    const pos = el.compareDocumentPosition(boundary);
    return Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function cleanLabel(value) {
    return String(value || "")
      .replace(/[\u00a0\u200e\u200f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[*:\s]+$/, "")
      .replace(/\s*\((required|optional|recommended|suggested)\)\s*$/i, "")
      .trim();
  }

  /** Nearest wrapper that plausibly represents one field row. */
  function fieldWrapper(control) {
    let node = control.parentElement;
    for (let depth = 0; depth < 4 && node; depth += 1) {
      const cls = String(node.getAttribute && (node.getAttribute("class") || ""));
      if (/row|field|attribute|specific|form|item/i.test(cls)) return node;
      if (node.tagName === "LI" || node.tagName === "TR" || node.tagName === "FIELDSET") return node;
      node = node.parentElement;
    }
    return control.parentElement || control;
  }

  function describedByText(control) {
    const ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map(txt)
      .join(" ");
  }

  /** Strings that are control/UI state, not eBay field names. */
  const BAD_LABEL_RX = [
    /^selected\b/,
    /^list of selected values$/,
    /list of selected values/,
    /^select$/,
    /^select (an?|the) .*/,
    /^choose\b/,
    /^open$/,
    /^close$/,
    /^clear\b/,
    /^remove\b/,
    /^search\b/,
    /^dropdown$/,
    /^menu$/,
    /^combobox$/,
    /^listbox$/,
    /^textbox$/,
    /^button$/,
    /^add\b/,
    /^edit$/,
    /^save$/,
    /^cancel$/,
    /^required$/,
    /^optional$/,
    /^suggested$/,
  ];

  /** Label-only validator used by Prompt Item Specific collection. */
  function isValidItemSpecificFieldLabel(label) {
    const raw = cleanLabel(label);
    if (!raw || raw.length > 60) return false;
    const n = normalize(raw);
    if (!n || !/[a-z0-9]/.test(n)) return false;
    if (n.split(" ").length > 6) return false;
    if (BAD_LABEL_RX.some((r) => r.test(n))) return false;
    return true;
  }

  function labelledByText(control) {
    const ids = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const parts = ids
      .map((id) => document.getElementById(id))
      .filter((node) => node && txt(node))
      .map(txt);
    return cleanLabel(parts.join(" "));
  }

  /**
   * Strict label-only resolver. accessibleName is a validated LAST resort because eBay custom
   * controls expose internal state such as "SelectedList of selected values".
   */
  function fieldLabel(control) {
    const wrapper = fieldWrapper(control);
    const candidates = [];

    const id = control.getAttribute("id");
    if (id) {
      const explicit = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (explicit) candidates.push(txt(explicit));
    }
    if (wrapper) {
      const inWrapper = wrapper.querySelector("label");
      if (inWrapper) candidates.push(txt(inWrapper));
    }
    candidates.push(labelledByText(control));
    if (wrapper) {
      const titleEl = wrapper.querySelector(
        "[class*='field-title'],[class*='fieldTitle'],[class*='field-label'],[class*='fieldLabel'],[class*='attribute-label'],[class*='label']",
      );
      if (titleEl) candidates.push(txt(titleEl));
      const semantic = wrapper.querySelector("dt,th,legend");
      if (semantic) candidates.push(txt(semantic));
    }
    let prev = control.previousElementSibling;
    while (prev) {
      candidates.push(txt(prev));
      prev = prev.previousElementSibling;
    }
    candidates.push(control.getAttribute("name") || "");
    candidates.push(accessibleName(control));

    for (const candidate of candidates) {
      const clean = cleanLabel(candidate);
      if (isValidItemSpecificFieldLabel(clean)) return clean;
    }
    return "";
  }

  /** Nearest preceding subgroup heading that matches one of the given patterns. */
  function governingHeading(control, region, boundary, patterns) {
    const headings = headingCandidates(region).filter(
      (el) => patterns.some((r) => r.test(normalize(txt(el)))) && isBeforeBoundary(el, boundary),
    );
    let best = null;
    headings.forEach((h) => {
      if (h.contains(control)) return;
      const pos = h.compareDocumentPosition(control);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        if (!best || best.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      }
    });
    if (!best) return null;
    const competing = headingCandidates(region).filter((el) => {
      const n = normalize(txt(el));
      return (
        (ADDITIONAL_RX.test(n) || SUGGESTED_RX.some((r) => r.test(n)) || REQUIRED_RX.some((r) => r.test(n))) &&
        el !== best &&
        !el.contains(best) &&
        !best.contains(el) &&
        best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
        el.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    return competing.length ? null : best;
  }

  function requiredSignals(control, region, boundary) {
    const reasons = [];
    if (control.required) reasons.push("required-attr");
    if (control.getAttribute("aria-required") === "true") reasons.push("aria-required");
    const wrapper = fieldWrapper(control);
    const cls = String((wrapper && wrapper.getAttribute && wrapper.getAttribute("class")) || "");
    if (/required/i.test(cls)) reasons.push("wrapper-class");
    const helper = `${describedByText(control)} ${wrapper ? txt(wrapper.querySelector("[class*='badge'],[class*='hint'],[class*='helper']")) : ""}`;
    if (/required/i.test(helper)) reasons.push("badge/helper");
    if (governingHeading(control, region, boundary, REQUIRED_RX)) reasons.push("required-heading");
    return reasons;
  }

  function suggestedSignals(control, region, boundary) {
    const reasons = [];
    if (governingHeading(control, region, boundary, SUGGESTED_RX)) reasons.push("suggested-heading");
    const wrapper = fieldWrapper(control);
    const cls = String((wrapper && wrapper.getAttribute && wrapper.getAttribute("class")) || "");
    if (/suggest|recommend/i.test(cls)) reasons.push("wrapper-class");
    const helper = `${describedByText(control)} ${
      wrapper
        ? txt(wrapper.querySelector("[class*='badge'],[class*='hint'],[class*='helper'],[class*='chip']"))
        : ""
    }`;
    if (/suggest|recommend/i.test(helper)) reasons.push("badge/helper");
    return reasons;
  }

  /** Candidate controls in DOM order, before the boundary, de-duplicated by nesting. */
  function candidateControls(region, boundary) {
    const all = Array.from((region || document.body).querySelectorAll(CONTROL_SELECTOR));
    const eligible = [];
    const rejected = { afterBoundary: 0, hidden: 0, nested: 0 };
    all.forEach((c) => {
      if (!isBeforeBoundary(c, boundary)) {
        rejected.afterBoundary += 1;
        return;
      }
      if (!isVisible(c)) {
        rejected.hidden += 1;
        return;
      }
      if (all.some((other) => other !== c && other.contains(c) && other.tagName !== "FIELDSET")) {
        rejected.nested += 1;
        return;
      }
      eligible.push(c);
    });
    return { eligible, rejected };
  }

  /** Strips technical wrappers such as `attributes.Brand` / `attributes[Brand]`. */
  function cleanTechnicalFieldName(value) {
    let out = String(value || "").trim();
    out = out.replace(/^attributes\s*\[\s*([^\]]+)\s*\]$/i, "$1");
    out = out.replace(/^attributes\s*[.:/]\s*/i, "");
    out = out.replace(/^item\s*specifics\s*[.:/]\s*/i, "");
    return out.trim();
  }

  function cleanRequiredLabels(labels) {
    const seen = new Set();
    const out = [];
    (labels || []).forEach((raw) => {
      const clean = cleanTechnicalFieldName(cleanLabel(raw));
      if (!clean || !isValidItemSpecificFieldLabel(clean)) return;
      const key = normalize(clean);
      if (seen.has(key)) return;
      out.push(clean);
      seen.add(key);
    });
    return out;
  }

  // ============================================================================
  // SUGGESTED-ONLY EXTRACTION (UNCHANGED)
  // ============================================================================

  const SUGGESTED_START_MARKERS = [
    { type: "suggested-item-specifics", rx: /^suggested item specifics$/, broad: false },
    { type: "item-specifics", rx: /^item specifics$/, broad: false },
    { type: "specifics", rx: /^specifics$/, broad: false },
    { type: "specs", rx: /^specs$/, broad: true },
    { type: "specific", rx: /^specific$/, broad: true },
  ];
  const SUGGESTED_REQUIRED_RX = [/^required$/, /^required item details$/, /^required item specifics$/];
  const SUGGESTED_ADDITIONAL_RX = ADDITIONAL_RX;

  const ACTION_LABEL_RX = [
    /^apply all$/,
    /^apply$/,
    /^select all$/,
    /^add all$/,
    /^apply suggestions?$/,
    /^dismiss$/,
    /^learn more$/,
  ];

  /** Strict DOM order: does `a` come before `b`? */
  function docPrecedes(a, b) {
    if (!a || !b || a === b) return false;
    const pos = a.compareDocumentPosition(b);
    return Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  /** FULL visible Suggested option text — no colon splitting, value preserved. */
  function normalizeOptionText(value) {
    const raw = String(value || "")
      .replace(/[\u00a0\u2007\u202f\u200e\u200f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s•*·-]+/, "")
      .replace(/[\s*]+$/, "")
      .trim();
    if (!raw) return "";
    if (raw.length > 90) return "";
    if (raw.split(" ").length > 12) return "";
    if (!/[a-z0-9]/i.test(raw)) return "";
    const n = normalize(raw);
    if (ACTION_LABEL_RX.some((r) => r.test(n))) return "";
    if (SUGGESTED_START_MARKERS.some((m) => m.rx.test(n))) return "";
    if (/powered by ebay|helps buyers|item specifics using/i.test(raw)) return "";
    return raw;
  }

  /** True when a label/row element is a real, usable option surface. */
  function isUsableOptionSurface(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest("template,[hidden],[aria-hidden='true']")) return false;
    let node = el;
    for (let depth = 0; depth < 12 && node && node.nodeType === 1; depth += 1) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  }

  /**
   * Resolves the visible option surface for a Suggested control. The native checkbox
   * itself may be visually hidden (opacity:0 / offscreen) on real eBay pages, so
   * usability is decided from the LABEL/ROW, never from the input.
   */
  function resolveSuggestedOption(control) {
    const surfaces = [];
    const id = control.getAttribute("id");
    if (id) {
      const explicit = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (explicit) surfaces.push(explicit);
    }
    const wrapping = control.closest("label");
    if (wrapping) surfaces.push(wrapping);
    const labelledBy = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    labelledBy.forEach((refId) => {
      const el = document.getElementById(refId);
      if (el) surfaces.push(el);
    });
    let sib = control.nextElementSibling;
    while (sib) {
      if (txt(sib)) surfaces.push(sib);
      sib = sib.nextElementSibling;
    }
    const row = control.parentElement;
    if (row) surfaces.push(row);

    for (const surface of surfaces) {
      if (!isUsableOptionSurface(surface)) continue;
      const text = normalizeOptionText(txt(surface));
      if (!text) continue;
      return { control, labelElement: surface, rowElement: row || surface, text };
    }
    const aria = normalizeOptionText(control.getAttribute("aria-label") || "");
    if (aria && isUsableOptionSurface(control.parentElement || control)) {
      return { control, labelElement: null, rowElement: control.parentElement || control, text: aria };
    }
    return null;
  }

  /** Controls in the ordered Suggested range; native visibility is intentionally NOT required. */
  function suggestedOptionControls(start, end) {
    return Array.from(document.querySelectorAll("input[type='checkbox'],[role='checkbox']")).filter(
      (cb) => docPrecedes(start, cb) && (!end || docPrecedes(cb, end)) && cb.isConnected,
    );
  }

  function firstHeadingAfter(start, patterns) {
    const matches = headingCandidates(document).filter(
      (el) => patterns.some((r) => r.test(normalize(txt(el)))) && docPrecedes(start, el),
    );
    let first = null;
    matches.forEach((el) => {
      if (!first || docPrecedes(el, first)) first = el;
    });
    return first;
  }

  function findSuggestedEndMarker(start) {
    const req = firstHeadingAfter(start, SUGGESTED_REQUIRED_RX);
    if (req) return { end: req, kind: "Required", requiredStop: true, additionalStop: false };
    const add = firstHeadingAfter(start, [SUGGESTED_ADDITIONAL_RX]);
    if (add) return { end: add, kind: "Additional (optional)", requiredStop: false, additionalStop: true };
    return { end: null, kind: "none", requiredStop: false, additionalStop: false };
  }

  /** Ordered start-marker candidates: by marker priority, then closest to options. */
  function suggestedStartCandidates() {
    const out = [];
    SUGGESTED_START_MARKERS.forEach((marker, rank) => {
      const found = headingCandidates(document).filter((el) => marker.rx.test(normalize(txt(el))));
      const deepest = new Set();
      found.forEach((el) => {
        if (found.some((other) => other !== el && el.contains(other))) return;
        deepest.add(el);
      });
      Array.from(deepest).forEach((el) => out.push({ el, rank, type: marker.type, broad: marker.broad }));
    });
    out.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : docPrecedes(a.el, b.el) ? 1 : -1));
    return out;
  }

  /** Visual order from the VISIBLE label/row geometry (never the hidden input's rect). */
  function inVisualOrder(options) {
    const rects = options.map((opt) => {
      const el = opt.labelElement || opt.rowElement || opt.control;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0 };
      return { opt, top: r.top || 0, left: r.left || 0 };
    });
    if (!rects.some((r) => r.top !== 0 || r.left !== 0)) return options;
    rects.sort((a, b) => (Math.abs(a.top - b.top) > 6 ? a.top - b.top : a.left - b.left));
    return rects.map((r) => r.opt);
  }

  /** Suggested-only scanner: START marker → options → STOP at Required, else Additional. */
  function scanSuggestedOnly() {
    const info = {
      startFound: false,
      startText: "",
      startType: "",
      requiredStop: false,
      additionalStop: false,
      endKind: "none",
      candidates: 0,
      validRows: 0,
      expected: false,
      options: [],
    };
    const starts = suggestedStartCandidates();
    for (const cand of starts) {
      const { end, kind, requiredStop, additionalStop } = findSuggestedEndMarker(cand.el);
      if (!end) continue;
      const controls = suggestedOptionControls(cand.el, end);
      const suggestedSeen = new Set();
      const resolved = [];
      controls.forEach((cb) => {
        const opt = resolveSuggestedOption(cb);
        if (!opt) return;
        const rowKey = opt.rowElement || opt.labelElement || cb;
        const key = `${normalize(opt.text)}`;
        if (suggestedSeen.has(key)) return;
        if (resolved.some((r) => r.rowElement === rowKey && normalize(r.text) === key)) return;
        suggestedSeen.add(key);
        resolved.push(opt);
      });
      if (!resolved.length) {
        if (!info.startFound && !cand.broad) {
          info.startFound = true;
          info.startText = txt(cand.el);
          info.startType = cand.type;
          info.endKind = kind;
          info.requiredStop = requiredStop;
          info.additionalStop = additionalStop;
          info.candidates = controls.length;
          info.expected = true;
        }
        continue;
      }
      const ordered = inVisualOrder(resolved);
      info.startFound = true;
      info.startText = txt(cand.el);
      info.startType = cand.type;
      info.requiredStop = requiredStop;
      info.additionalStop = additionalStop || Boolean(firstHeadingAfter(cand.el, [SUGGESTED_ADDITIONAL_RX]));
      info.endKind = kind;
      info.candidates = controls.length;
      info.validRows = ordered.length;
      info.expected = true;
      info.options = ordered.map((o) => o.text);
      return info;
    }
    return info;
  }

  function classify(region, boundary) {
    const { eligible, rejected } = candidateControls(region, boundary);
    const suggested = [];
    const required = [];
    const skipped = [];
    const seen = new Set();
    eligible.forEach((c) => {
      const name = fieldLabel(c);
      if (!name) {
        skipped.push({ reason: "no-valid-field-label", tag: c.tagName });
        return;
      }
      const key = normalize(name);
      if (seen.has(key)) {
        skipped.push({ reason: "duplicate-logical-field", field: name });
        return;
      }
      const sug = suggestedSignals(c, region, boundary);
      const req = requiredSignals(c, region, boundary);
      if (sug.length) {
        seen.add(key);
        suggested.push(name);
        return;
      }
      if (req.length) {
        seen.add(key);
        required.push(name);
        return;
      }
      skipped.push({ reason: "no-suggested/required-signal", field: name });
    });
    return { suggested, required, rejected, skipped, candidateCount: eligible.length };
  }

  /** True when the page shows a Required heading before the Additional boundary. */
  function requiredHeadingPresent(region, boundary) {
    return Boolean(
      headingCandidates(region && region.isConnected ? region : document).some(
        (el) => REQUIRED_RX.some((r) => r.test(normalize(txt(el)))) && isBeforeBoundary(el, boundary),
      ),
    );
  }



  function scanOnce({ debug = false } = {}) {
    const region = findItemSpecificsRegion();
    const additionalBoundary = findAdditionalBoundary(region);
    const suggestedInfo = scanSuggestedOnly();
    
    // Use PROVEN classify() from ZIP #2 (golden reference for Required extraction)
    const generic = classify(region, additionalBoundary);

    const suggested = suggestedInfo.options;
    const required = cleanRequiredLabels(generic.required);

    // ZIP #2's logic for requiredExpected
    const requiredExpected = requiredHeadingPresent(region, additionalBoundary) || required.length > 0;
    
    // Adapt requiredResolved flag for snapshot system:
    // - No Required heading + no fields → resolved (nothing to resolve)
    // - Required heading + fields → resolved (got the fields)
    // - Required heading + no fields → unresolved (still loading)
    const requiredResolved = !requiredExpected || required.length > 0;
    
    const out = {
      suggested,
      required,
      suggestedExpected: suggestedInfo.expected,
      requiredExpected,
      requiredResolved, // Snapshot flag: is Required extraction complete?
    };
    if (debug && log) {
      log("eBay Item Specifics", {
        "Suggested / Start found": suggestedInfo.startFound,
        "Suggested / Start": suggestedInfo.startText,
        "Suggested / End": suggestedInfo.endKind,
        "Suggested / Expected": suggestedInfo.expected,
        "Suggested / Option controls": suggestedInfo.candidates,
        "Suggested / Valid visible option rows": suggestedInfo.validRows,
        "Suggested / Output": suggested.map((v, i) => `${i + 1}. ${v}`),
        "Required / Heading found": requiredHeadingPresent(region, additionalBoundary),
        "Required / Expected": requiredExpected,
        "Required / Generic candidates": generic.candidateCount,
        "Required / Output": required.map((v, i) => `${i + 1}. ${v}`),
        "Additional boundary": additionalBoundary ? txt(additionalBoundary) : "",
      });
    }
    return out;
  }

  function scanSuggestedItemSpecifics() {
    return scanOnce().suggested;
  }

  function scanRequiredFields() {
    return scanOnce().required;
  }

  // ============================================================================
  // NEW RETRY LOGIC: PREVENT EXPECTED-BUT-UNRESOLVED TRAP
  // ============================================================================

  function isComplete(r) {
    // Don't treat unresolved section as incomplete just because heading was found
    // If staleUnresolved flag is set, it's a structural issue, not a loading issue
    if (r.staleUnresolved) {
      return true; // Mark as "complete" to stop retrying
    }

    // CRITICAL: If Required heading expected but NOT resolved, keep trying
    // A snapshot with requiredExpected=true but requiredResolved=false is transient/incomplete
    if (r.requiredExpected && r.requiredResolved === false) {
      return false; // Incomplete - Required section not fully resolved yet
    }

    return (
      (!r.suggestedExpected || r.suggested.length > 0) &&
      (!r.requiredExpected || r.required.length > 0)
    );
  }

  function sameResult(a, b) {
    return (
      Boolean(a) &&
      Boolean(b) &&
      a.suggested.join("|") === b.suggested.join("|") &&
      a.required.join("|") === b.required.join("|")
    );
  }

  /**
   * CORE FIX: scanItemSpecifics with bounded attempts and stale-unresolved detection.
   * 
   * This now:
   * 1. Stops early if result is stable and complete
   * 2. Detects expected-but-unresolved and marks it as stale (not "still loading")
   * 3. Never gets trapped in 6-second retry loop on same unchanging unresolved DOM
   * 4. Returns best-effort result if still incomplete after bounded attempts
   */
  async function scanItemSpecifics({ attempts = 5, wait = 300, timeout = 2000 } = {}) {
    // NOTE: Reduced attempts and timeout here since snapshot handles long-term caching
    // This is only called when snapshot is stale, so keep it brief
    
    const deadline = Date.now() + timeout;
    let result = { suggested: [], required: [], suggestedExpected: false, requiredExpected: false };
    let previous = null;
    let stable = 0;

    for (let i = 0; i < attempts; i += 1) {
      result = scanOnce({ debug: i === 0 });

      // Mark stale unresolved states
      if (previous && isExpectedButUnresolved(result) && isExpectedButUnresolved(previous)) {
        result = markStaleUnresolvedIfApplicable(result, previous);
      }

      if (isComplete(result)) {
        stable = sameResult(previous, result) ? stable + 1 : 1;
        if (stable >= 2 || Date.now() >= deadline) {
          scanOnce({ debug: true });
          return result;
        }
      } else {
        stable = 0;
      }

      previous = result;
      if (i === attempts - 1 || Date.now() >= deadline) break;
      if (sleep) await sleep(wait);
    }

    // Return best-effort result
    scanOnce({ debug: true });
    return result;
  }

  // ============================================================================
  // PUBLIC API: SNAPSHOT-BASED PROMPT EXECUTION
  // ============================================================================

  /**
   * Get current valid snapshot for immediate Prompt use.
   * Returns snapshot if valid/recent, null otherwise.
   */
  function getSnapshotForPrompt() {
    if (isSnapshotRecent()) {
      return snapshot;
    }
    if (isSnapshotValid()) {
      return snapshot;
    }
    return null;
  }

  /**
   * Perform a bounded refresh when snapshot is stale.
   * Used by Prompt when current snapshot is outdated.
   * This is a short scan (500ms-1s), not a full 6-second wait.
   */
  async function refreshSnapshotIfStale() {
    if (isSnapshotValid()) {
      return snapshot; // Already valid
    }

    // Generate new version for this refresh
    generation += 1;
    const currentGen = generation;
    pendingRefreshGenerationId = currentGen;

    try {
      const result = await scanItemSpecifics({ attempts: 3, wait: 200, timeout: 1000 });

      // Only update if this generation is still current
      if (currentGen === generation && updateSnapshot(result)) {
        return result;
      }
    } finally {
      if (pendingRefreshGenerationId === currentGen) {
        pendingRefreshGenerationId = null;
      }
    }

    // Return stale snapshot as fallback
    return snapshot;
  }

  /**
   * Start automatic background observation of Item Specifics region.
   * Called once on eBay page load to enable auto-invalidation on DOM changes.
   */
  function initializeObserver() {
    if (mutationObserverInstance) return; // Already initialized
    observeItemSpecificsRegion();
  }

  // ============================================================================
  // EXPORT API
  // ============================================================================

  AEB.ebayItemSpecifics = {
    // Core extraction (unchanged)
    normalize,
    findItemSpecificsRegion,
    findAdditionalBoundary,
    isBeforeBoundary,
    isValidItemSpecificFieldLabel,
    fieldLabel,
    cleanTechnicalFieldName,
    cleanRequiredLabels,
    resolveSuggestedOption,
    scanSuggestedOnly,
    scanOnce,
    scanSuggestedItemSpecifics,
    scanRequiredFields,

    // NEW: Snapshot-based API
    scanItemSpecifics,
    getSnapshotForPrompt,
    refreshSnapshotIfStale,
    initializeObserver,
    currentSnapshot,
    isSnapshotValid,
    isSnapshotRecent,

    // DEBUG: State inspection
    __debugState: () => ({
      generation,
      snapshotGenerationId,
      snapshotTimestamp,
      isValid: isSnapshotValid(),
      isRecent: isSnapshotRecent(),
      snapshot,
    }),
  };
})();

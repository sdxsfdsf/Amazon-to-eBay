/* Determines which variation is currently selected, and the selected child ASIN. */
(function () {
  "use strict";

  const P = window.AIDParser;

  function text(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  /** Strategy A: twister rows render "Size: CO 4910AC" in .selection spans. */
  function fromTwisterRows() {
    const dims = [];
    const rows = document.querySelectorAll(
      "#twister .a-row, #twisterContainer .a-row, #twister_feature_div .a-row, form#twister .a-row"
    );
    rows.forEach(function (row) {
      const label = row.querySelector("label, .a-form-label, .a-text-bold");
      const value = row.querySelector(".selection, .a-dropdown-prompt, .twisterTextDiv span");
      const name = text(label).replace(/[:\s]+$/, "");
      const val = text(value);
      if (name && val && val.length < 120) dims.push({ name: name, value: val });
    });
    return dims;
  }

  /** Strategy B: variation summary list (newer layout). */
  function fromInlineTwisterSummary() {
    const dims = [];
    document
      .querySelectorAll("#twisterPlusWWDesktop .a-row, .inline-twister-row")
      .forEach(function (row) {
        const name = text(row.querySelector(".a-form-label, .inline-twister-dim-title-value-truncate-expanded, .a-text-bold"));
        const val = text(
          row.querySelector(".inline-twister-dim-title-value, .selection, .a-dropdown-prompt")
        );
        if (name && val) dims.push({ name: name.replace(/[:\s]+$/, ""), value: val });
      });
    return dims;
  }

  /** Strategy C: embedded twister data (selected_variations / variationValues). */
  function fromTwisterData() {
    const data = P.getTwisterData();
    if (!data) return [];
    const selected = data.selected_variations || data.selectedVariations || null;
    const labels = data.variationDisplayLabels || {};
    if (selected && typeof selected === "object") {
      return Object.keys(selected).map(function (k) {
        return { name: labels[k] || prettyDim(k), value: String(selected[k]) };
      });
    }
    return [];
  }

  function prettyDim(key) {
    return String(key)
      .replace(/_name$/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }

  /** Currently selected child ASIN. */
  function getSelectedAsin() {
    const candidates = [
      function () {
        const el = document.querySelector("#twister input[name='ASIN'], input#ASIN");
        return el && el.value;
      },
      function () {
        const el = document.querySelector(
          "#twister .swatchSelect[data-defaultasin], #twister li.swatchSelect[data-dp-url]"
        );
        if (!el) return null;
        const a = el.getAttribute("data-defaultasin");
        if (a) return a;
        const url = el.getAttribute("data-dp-url") || "";
        const m = url.match(/\/dp\/([A-Z0-9]{10})/i);
        return m && m[1];
      },
      function () {
        const el = document.querySelector("[data-csa-c-asin]");
        return el && el.getAttribute("data-csa-c-asin");
      },
      function () {
        return P.getPageAsin();
      },
    ];
    for (const fn of candidates) {
      try {
        const v = fn();
        if (v && /^[A-Z0-9]{10}$/i.test(v)) return v.toUpperCase();
      } catch (_) {
        /* ignore */
      }
    }
    return null;
  }

  function dedupeDims(list) {
    const seen = new Set();
    const out = [];
    list.forEach(function (d) {
      const key = d.name.toLowerCase();
      if (!d.value || seen.has(key)) return;
      seen.add(key);
      out.push(d);
    });
    return out;
  }

  /** Public: full variation snapshot for the current page state. */
  function detect() {
    const dims = dedupeDims(
      [].concat(fromTwisterRows(), fromInlineTwisterSummary(), fromTwisterData())
    );
    const asin = getSelectedAsin();
    const title = (document.getElementById("productTitle") || {}).textContent || "";
    return {
      asin: asin,
      dimensions: dims,
      title: title.replace(/\s+/g, " ").trim(),
      label: dims.length
        ? dims
            .map(function (d) {
              return d.value;
            })
            .join(" / ")
        : "Default",
      signature: [asin || "", dims.map(function (d) { return d.name + "=" + d.value; }).join("|")].join("::"),
    };
  }

  window.AIDVariation = { detect: detect, getSelectedAsin: getSelectedAsin };
})();

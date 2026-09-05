/* global window */
/*
 * Injects real rich HTML into eBay's actual Description editor, then verifies
 * that eBay retained it after a rerender.
 *
 * Write + verification logic imported from amazon-ebay-assistant 1.7
 * (AEB.ebayRealFieldWriter), plus one extra strict gate required here:
 *
 *   The target section must be introduced by a heading whose text is EXACTLY
 *   "Description" as a standalone heading. Sections labelled
 *   "Conditional Description", "Product Description", "Description Settings"
 *   (or anything else where "Description" is part of a longer label) are
 *   rejected. If no exact standalone "Description" header exists, nothing is
 *   written anywhere and DESCRIPTION_HEADER_NOT_FOUND is returned.
 *
 * Public API is unchanged from v2.4 so no caller had to change.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { txt, log } = AEB;

  const writer = () => AEB.ebayRealFieldWriter;

  /** { type, el, section } or { error } — kept for API compatibility. */
  function getRealDescriptionEditor() {
    const editor = writer().findRealEbayDescriptionEditor();
    if (editor.error) return { error: editor.error };
    return { type: editor.kind, el: editor.element, section: editor.section, editor };
  }

  /** Content check against the data we intended to write (v2.4 behaviour, kept). */
  function verifyDescriptionContent(descriptionData) {
    const target = getRealDescriptionEditor();
    if (target.error) return false;
    const content = writer().readDescription(target.editor);
    const plainContent = target.type === "textarea" ? content : txt(target.el);
    const expectations = [];
    if ((descriptionData.bullets || []).length) {
      expectations.push(descriptionData.heading || "About this item");
      expectations.push(descriptionData.bullets[0].slice(0, 24));
    }
    // Same filter the rendered Description uses, so verification never expects
    // a Product Details row that the blocklist removed.
    const attrs = AEB.description.filterDescriptionAttributes(descriptionData.attributes);
    if (attrs.length) expectations.push(String(attrs[0].value).slice(0, 16));
    if (descriptionData.standaloneText) expectations.push(descriptionData.standaloneText.slice(0, 24));
    if (!expectations.length) return Boolean(content && content.trim());
    return expectations.every((e) => plainContent.includes(e) || content.includes(e));
  }

  /**
   * True when the editor's VISIBLE text contains our own markup as literal,
   * escaped characters instead of rendered elements — the specific "the code
   * became visible instead of the design" failure. Something upstream (an
   * eBay re-render, a save/reload round trip through eBay's own draft
   * storage, ...) treated our HTML as plain text and escaped it instead of
   * parsing it. A raw HTML/source editor (kind "textarea") is exempt —
   * showing source there is what that view is for, not a failure.
   */
  function editorShowsRawMarkup() {
    const target = getRealDescriptionEditor();
    if (target.error || target.type === "textarea") return false;
    const visible = txt(target.el);
    if (!visible) return false;
    return /<\/?\s*(div|section|table|tr|td|style|span|ul|li)\b/i.test(visible) || visible.includes("aeb-listing");
  }

  /**
   * Re-applies `descriptionData` whenever the live editor no longer matches
   * it — including the "shows raw markup" failure above. Meant to run once
   * per eBay page load (a full reload re-injects this content script from
   * scratch), so the Description a shopper sees never depends on eBay having
   * preserved our rendering across that reload. Silent and best-effort:
   * never throws, and does nothing when the editor already looks right, so
   * it's safe to call unconditionally on every page load.
   */
  async function restoreIfNeeded(descriptionData) {
    if (!descriptionData) return { attempted: false };
    try {
      const intact = verifyDescriptionContent(descriptionData) && !editorShowsRawMarkup();
      if (intact) return { attempted: false };
      const res = await injectRichDescription(descriptionData);
      return Object.assign({ attempted: true }, res);
    } catch {
      return { attempted: false };
    }
  }

  async function injectRichDescription(descriptionData) {
    const html = AEB.description.buildDescriptionHTML(descriptionData);
    const plain = AEB.description.buildDescriptionPlainText(descriptionData);

    const res = await writer().writeRealDescription(html, plain);

    const located = writer().findDescriptionSectionStrict();
    log("eBay Description", {
      "Exact standalone 'Description' header": !located.error,
      "Editor found": res.code !== "DESCRIPTION_EDITOR_NOT_FOUND" && !!res.actual,
      "HTML length": html.length,
      "Post-render verification": res.ok,
      "Still editable": res.editable,
      code: res.ok ? null : res.code,
    });

    if (res.ok) return { ok: true };

    const messages = {
      DESCRIPTION_HEADER_NOT_FOUND:
        "No section with an exact standalone 'Description' header was found. Nothing was written.",
      DESCRIPTION_EDITOR_NOT_FOUND: "The 'Description' section was found, but it exposes no editor.",
      DESCRIPTION_NOT_PERSISTED: "Description editor found, but eBay did not accept the content.",
    };
    return { ok: false, code: res.code, message: messages[res.code] || res.reason };
  }

  AEB.ebayDescription = {
    getRealDescriptionEditor,
    injectRichDescription,
    verifyDescriptionContent,
    editorShowsRawMarkup,
    restoreIfNeeded,
  };
})();

/* global window */
/* Strict section location. Never a global text search as the final target. */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { findSectionByHeading, txt, isVisible } = AEB;

  function findPricingSection() {
    const found =
      findSectionByHeading([/^pricing$/i, /^price and (quantity|format)/i, /^pricing\b/i]) ||
      findSectionByHeading([/format and pricing/i]);
    if (found) return found.section;
    // Controlled structural fallback: a container that owns BOTH an item-price and a quantity label.
    const containers = Array.from(document.querySelectorAll("section,form,div"));
    for (const c of containers) {
      if (!isVisible(c)) continue;
      if (c.querySelectorAll("input").length > 12) continue;
      const t = txt(c).toLowerCase();
      if (/item price|buy it now price|price\b/.test(t) && /quantity/.test(t) && t.length < 1200) return c;
    }
    return null;
  }

  function findDescriptionSection() {
    const found =
      findSectionByHeading([/^description$/i, /^item description$/i, /listing description/i], {
        requireControls: false,
      }) || null;
    if (found) return found.section;
    const holder = Array.from(document.querySelectorAll("section,div")).find(
      (c) =>
        isVisible(c) &&
        /description/i.test(txt(c).slice(0, 200)) &&
        c.querySelector("[contenteditable='true'], textarea, iframe"),
    );
    return holder || null;
  }

  function findPhotoSection() {
    const headingPatterns = [/^photos?$/i, /^pictures?$/i, /photos?\s*(?:&|and)\s*video/i];
    const headings = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,legend,[role='heading'],[class*='title'],[class*='heading']"),
    );

    // eBay wraps the "Photos & Video" heading in a small title-only div. A
    // generic heading lookup with requireControls:false therefore returns a
    // scope that does not contain the gallery or its n/25 counter. Uploading
    // still works through the document-wide input fallback, but completion
    // verification remains blind. Climb until the smallest ancestor owns an
    // actual gallery signal instead.
    for (const heading of headings) {
      const headingText = txt(heading);
      if (!headingText || headingText.length > 80 || !isVisible(heading)) continue;
      if (!headingPatterns.some((pattern) => pattern.test(headingText))) continue;

      let node = heading;
      for (let depth = 0; depth < 10 && node; depth += 1) {
        node = node.parentElement;
        if (!node) break;
        const text = txt(node);
        const hasGalleryCounter = /(?:^|[^0-9])\d{1,2}\s*\/\s*(?:24|25)(?=$|[^0-9])/.test(text);
        const hasImageInput = Boolean(node.querySelector("input[type='file'][accept*='image']"));
        const hasGalleryImages = node.querySelectorAll("img").length > 0;
        if (hasGalleryCounter || hasImageInput || hasGalleryImages) return node;
      }
    }

    // Keep the fallback bounded to a semantic section/form where possible;
    // input.closest('div') alone is commonly just a tiny control wrapper.
    const input = document.querySelector("input[type='file'][accept*='image']");
    return input ? input.closest("section,form") || input.closest("div") : null;
  }

  AEB.ebaySections = { findPricingSection, findDescriptionSection, findPhotoSection };
})();

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
    const found = findSectionByHeading([/^photos?$/i, /^pictures?$/i, /photos? and video/i], {
      requireControls: false,
    });
    if (found) return found.section;
    const input = document.querySelector("input[type='file'][accept*='image']");
    return input ? input.closest("section,form,div") : null;
  }

  /**
   * Returns / Return policy — lives under Preferences -> Your settings ->
   * Returns in eBay's listing form. Tries the exact heading first; falls
   * back to a bounded structural search for a container that specifically
   * mentions "return policy" and holds a plausible policy-selection control,
   * so an unrelated page section merely containing the word "return"
   * (shipping, refund terms elsewhere) is never mistaken for it.
   */
  function findReturnsSection() {
    const found = findSectionByHeading(
      [/^returns?$/i, /^return policy$/i, /^returns?\s*(&|and)\s*refunds?$/i, /^your\s+return\s+policy$/i],
      { requireControls: false },
    );
    if (found) return found.section;
    const containers = Array.from(document.querySelectorAll("section,form,div"));
    for (const c of containers) {
      if (!isVisible(c)) continue;
      if (c.querySelectorAll("input,select,button,a").length > 40) continue; // avoid matching the whole page
      const t = txt(c).toLowerCase();
      if (/return policy/.test(t) && (c.querySelector("select") || c.querySelector("input[type='radio']")) && t.length < 1500) {
        return c;
      }
    }
    return null;
  }

  AEB.ebaySections = { findPricingSection, findDescriptionSection, findPhotoSection, findReturnsSection };
})();

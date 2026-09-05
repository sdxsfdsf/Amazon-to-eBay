/* global window */
/*
 * Shared "find the active offer" scope for the Amazon-side detectors that
 * must never fall back to a page-wide search (Prime eligibility, return
 * policy). Anchored on the same price containers amazonCapture.js already
 * trusts, then climbed a bounded number of levels to the surrounding
 * buy-box/delivery region — never `document`. Kept in one place so both
 * detectors agree on exactly what counts as "the current offer", matching
 * this codebase's existing pattern of a shared section-finder for the
 * eBay-side writers (see ebay/ebaySectionScanner.js).
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  /** The same price containers amazonCapture.js's currentPrice() already trusts. */
  const PRICE_ANCHORS = [
    "#corePriceDisplay_desktop_feature_div",
    "#corePrice_feature_div",
    "#apex_desktop",
    "#price_inside_buybox",
    "#newBuyBoxPrice",
  ];

  /** Known buy-box / delivery-block container ids, used only to bound the climb below. */
  const BUYBOX_CONTAINERS = "#desktop_buybox, #buybox, #addToCart_feature_div, #buyBoxAccordion, #usedBuyBoxWrapper";
  const DELIVERY_BLOCK_HINT =
    "#deliveryBlockMessage, #mir-layout-DELIVERY_BLOCK-slot-primary_delivery_message_v2, [data-csa-c-content-id*='delivery']";

  /**
   * The active offer's own region: anchored on a verified price element,
   * climbed a bounded number of levels to the surrounding buy-box/delivery
   * area. Returns null — never a wider guess — if none of the price anchors
   * exist at all.
   */
  function currentOfferScope() {
    let anchor = null;
    for (const sel of PRICE_ANCHORS) {
      anchor = document.querySelector(sel);
      if (anchor) break;
    }
    if (!anchor) return null;

    const direct = anchor.closest(BUYBOX_CONTAINERS);
    if (direct) return direct;

    let node = anchor;
    for (let i = 0; i < 6 && node; i += 1) {
      node = node.parentElement;
      if (node && node.matches && node.matches(BUYBOX_CONTAINERS)) return node;
      if (node && node.querySelector && node.querySelector(DELIVERY_BLOCK_HINT)) return node;
    }
    // Bounded fallback: still anchored on the verified price element, just
    // its immediate surroundings rather than the whole page.
    return anchor.parentElement || anchor;
  }

  AEB.amazonOffer = { currentOfferScope };
})();

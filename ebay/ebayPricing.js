/* global window */
/*
 * Price and Quantity go ONLY to Pricing → Item price / Pricing → Quantity.
 *
 * The locating + writing + verification logic is imported from
 * amazon-ebay-assistant 1.7 (AEB.ebayRealFieldWriter). This module keeps the
 * v2.4 public API (getItemPriceField / getQuantityField / fillItemPrice /
 * fillQuantity / numeric) so no caller had to change.
 *
 * There is deliberately NO similarly-named fallback: if the exact "Item price"
 * or "Quantity" control cannot be found inside the confirmed PRICING section,
 * nothing is written and a failure code is returned.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { log } = AEB;

  const writer = () => AEB.ebayRealFieldWriter;

  const numeric = (v) => {
    const m = String(v == null ? "" : v).replace(/[^0-9.]/g, "");
    return m === "" ? null : Number(m);
  };

  /** { el, section } or { error } — strictly inside PRICING. */
  function getItemPriceField() {
    const found = writer().locateInPricing("price");
    if (found.error) return { error: found.error, section: found.container || null };
    return { el: found.element, section: found.container };
  }

  /** { el, section } or { error } — strictly inside PRICING. */
  function getQuantityField() {
    const found = writer().locateInPricing("quantity");
    if (found.error) return { error: found.error, section: found.container || null };
    return { el: found.element, section: found.container };
  }

  async function fillItemPrice(price) {
    const res = await writer().writeRealPrice(price);
    log("eBay Price", {
      "Pricing section": Boolean(writer().findPricingContainer()),
      Expected: Number(price).toFixed(2),
      Actual: res.actual,
      Verified: res.ok,
      "Still editable": res.editable,
      code: res.ok ? null : res.code,
    });
    return res.ok ? { ok: true, actual: res.actual } : { ok: false, code: res.code };
  }

  async function fillQuantity(qty) {
    const res = await writer().writeRealQuantity(qty);
    log("eBay Quantity", {
      "Pricing section": Boolean(writer().findPricingContainer()),
      Expected: String(qty),
      Actual: res.actual,
      Verified: res.ok,
      "Still editable": res.editable,
      code: res.ok ? null : res.code,
    });
    return res.ok ? { ok: true, actual: res.actual } : { ok: false, code: res.code };
  }

  AEB.ebayPricing = { getItemPriceField, getQuantityField, fillItemPrice, fillQuantity, numeric };
})();

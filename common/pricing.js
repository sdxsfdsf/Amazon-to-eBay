/* Deterministic pricing engine. No AI. Shared by panel + tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AEB = root.AEB || {};
  root.AEB.pricing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FIXED_FEE_UNDER_10 = 0.3;
  const FIXED_FEE_10_PLUS = 0.4;

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /**
   * Amazon Cost = Amazon Price × (1 + Tax Rate)
   * Required Return = Amazon Cost × (1 + Target Profit Rate)
   * Raw Selling Price = (Required Return + applicable fixed eBay order fee)
   *                     ÷ (1 - Final Value Fee - Promoted Listing Rate)
   *
   * The fixed per-order fee depends on which side of $10 the FINAL price
   * lands on, but the final price is exactly what this formula solves for.
   * Handled the same way the fee tables themselves are structured: compute
   * the price assuming the LOWER ($0.30) fee, and accept it only if that
   * assumption is self-consistent (the result really is under $10). Raising
   * the fixed fee only ever increases the price, so if the low-fee
   * assumption already lands at $10+, the high-fee ($0.40) assumption is
   * guaranteed to be the self-consistent one — there's no case where
   * neither candidate is valid.
   */
  function computeRawSellingPrice(amazonPrice, settings) {
    const A = Number(amazonPrice) || 0;
    const taxRate = Number(settings.taxRate) / 100;
    const profitRate = Number(settings.targetProfit) / 100;
    const feeRate = Number(settings.finalValueFee) / 100 + Number(settings.promotedRate) / 100;
    // A configured fee total at or above 100% of the selling price makes the
    // formula unsolvable (or negative/infinite) — floor the divisor so a
    // nonsensical settings combination produces a very large, clearly-off
    // price instead of Infinity, NaN, or a negative number silently
    // reaching the eBay fields.
    const divisor = Math.max(1 - feeRate, 0.01);

    const requiredReturn = A * (1 + taxRate) * (1 + profitRate);
    const candidateUnder10 = (requiredReturn + FIXED_FEE_UNDER_10) / divisor;
    const raw = candidateUnder10 < 10 ? candidateUnder10 : (requiredReturn + FIXED_FEE_10_PLUS) / divisor;
    return round2(raw);
  }

  /**
   * Resolves which flat {taxRate, finalValueFee, promotedRate, targetProfit}
   * settings apply to a given (locked) Amazon price. Honors Advanced
   * Pricing when it's enabled and configured; otherwise — or whenever
   * Advanced Pricing has no ranges to use — falls back to the ordinary
   * flat `settings.pricing`, unchanged from today's behavior.
   *
   * `advancedPricing.thresholds` holds up to 2 breakpoints; `ranges` holds
   * one flat settings object per resulting range (thresholds.length + 1),
   * in ascending price order: below the first threshold, between the two,
   * at or above the last one.
   */
  function resolvePricingSettings(amazonPrice, settings) {
    const flat = (settings && settings.pricing) || {};
    const adv = settings && settings.advancedPricing;
    if (!adv || !adv.enabled || !Array.isArray(adv.ranges) || !adv.ranges.length) return flat;

    const thresholds = (adv.thresholds || [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    const A = Number(amazonPrice) || 0;
    let idx = 0;
    while (idx < thresholds.length && A >= thresholds[idx]) idx += 1;
    const range = adv.ranges[idx] || adv.ranges[adv.ranges.length - 1];
    return range && Number.isFinite(Number(range.taxRate)) ? range : flat;
  }

  function applyPriceEnding(rawSellingPrice) {
    const floorValue = Math.floor(rawSellingPrice);
    const decimal = round2(rawSellingPrice - floorValue);
    if (decimal <= 0.25) return round2(floorValue - 1 + 0.99);
    if (decimal <= 0.75) return round2(floorValue + 0.49);
    return round2(floorValue + 0.99);
  }

  function quantityFor(finalSellingPrice) {
    return finalSellingPrice >= 36 ? 4 : 5;
  }

  /** Profit implied by a given selling price under the same fee model. */
  function profitFor(sellingPrice, amazonPrice, settings) {
    const A = Number(amazonPrice) || 0;
    const cost = A * (1 + Number(settings.taxRate) / 100);
    const pctFees =
      sellingPrice * (Number(settings.finalValueFee) / 100 + Number(settings.promotedRate) / 100);
    const fixed = sellingPrice < 10 ? FIXED_FEE_UNDER_10 : FIXED_FEE_10_PLUS;
    return round2(sellingPrice - pctFees - fixed - cost);
  }

  function calculate(amazonPrice, settings) {
    const raw = computeRawSellingPrice(amazonPrice, settings);
    const finalSellingPrice = applyPriceEnding(raw);
    const expectedProfit = profitFor(raw, amazonPrice, settings);
    const actualProfit = profitFor(finalSellingPrice, amazonPrice, settings);
    const cost = (Number(amazonPrice) || 0) * (1 + Number(settings.taxRate) / 100);
    return {
      rawSellingPrice: raw,
      finalSellingPrice,
      expectedProfit,
      actualProfit,
      actualProfitPct: cost > 0 ? round2((actualProfit / cost) * 100) : 0,
      quantity: quantityFor(finalSellingPrice),
    };
  }

  return {
    FIXED_FEE_UNDER_10,
    FIXED_FEE_10_PLUS,
    round2,
    computeRawSellingPrice,
    resolvePricingSettings,
    applyPriceEnding,
    quantityFor,
    profitFor,
    calculate,
  };
});

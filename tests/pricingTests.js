/*
 * Tests for common/pricing.js — the dynamic fee-percentage fix (no more
 * hardcoded /0.8) and the new Advanced Pricing range resolver. Node-only;
 * not loaded by the extension.
 *   run with:  node tests/pricingTests.js
 */
const P = require(require("path").join(__dirname, "..", "common", "pricing.js"));

let pass = 0;
let fail = 0;
function ck(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${extra ? " -- " + extra : ""}`);
  }
}

const DEFAULT_SETTINGS = { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 };

console.log("\n[A] Fee percentages genuinely drive the Selling Price (the core bug)");
{
  const base = P.calculate(20, DEFAULT_SETTINGS);
  const higherFvf = P.calculate(20, { ...DEFAULT_SETTINGS, finalValueFee: 20 });
  ck(
    "raising Final Value Fee raises the selling price",
    higherFvf.finalSellingPrice > base.finalSellingPrice,
    `${base.finalSellingPrice} vs ${higherFvf.finalSellingPrice}`,
  );
  const higherPromoted = P.calculate(20, { ...DEFAULT_SETTINGS, promotedRate: 15 });
  ck(
    "raising Promoted Listing Rate raises the selling price",
    higherPromoted.finalSellingPrice > base.finalSellingPrice,
    `${base.finalSellingPrice} vs ${higherPromoted.finalSellingPrice}`,
  );
  const zeroFees = P.calculate(20, { ...DEFAULT_SETTINGS, finalValueFee: 0, promotedRate: 0 });
  ck(
    "zero fees produce a materially lower price than 20.5% fees",
    zeroFees.finalSellingPrice < base.finalSellingPrice,
    `${zeroFees.finalSellingPrice} vs ${base.finalSellingPrice}`,
  );
  ck("no lingering hardcoded 0.8 divisor constant on the module", P.computeRawSellingPrice !== undefined && !("SHEET_DIVISOR" in P));
}

console.log("\n[B] Exact worked example from the spec (Amazon $10, 8% tax, 15% target, 13.5%+7% fees)");
{
  // Amazon cost after tax: 10 * 1.08 = 10.80
  // Required profit: 10.80 * 0.15 = 1.62 -> Required Return = 12.42
  // Divisor = 1 - 0.205 = 0.795
  // Candidate <$10 fee: (12.42+0.30)/0.795 = 16.00 -> not < 10, so use the $10+ fee
  // Raw = (12.42+0.40)/0.795 = 16.1257... -> rounds to 16.13
  const raw = P.computeRawSellingPrice(10, DEFAULT_SETTINGS);
  ck("raw selling price matches the hand-worked formula", raw === 16.13, String(raw));
  const calc = P.calculate(10, DEFAULT_SETTINGS);
  ck("expected profit (on the raw price) matches the spec's $1.62 requirement", calc.expectedProfit === 1.62, String(calc.expectedProfit));
}

console.log("\n[C] Fixed per-order fee: verified against the actual candidate, not blindly assumed");
{
  // A low Amazon price should land the raw price under $10, using the $0.30 fee.
  const low = P.calculate(1, DEFAULT_SETTINGS);
  ck("low Amazon price -> raw price lands under $10", low.rawSellingPrice < 10, String(low.rawSellingPrice));
  // Manually confirm the $0.30 fee (not $0.40) was the one used for that candidate.
  const withLowFee = (1 * 1.08 * 1.15 + 0.3) / (1 - 0.205);
  ck("that raw price used the $0.30 fee candidate", Math.abs(low.rawSellingPrice - Math.round(withLowFee * 100) / 100) < 0.001);

  // A higher Amazon price should land at/above $10, using the $0.40 fee.
  const high = P.calculate(50, DEFAULT_SETTINGS);
  ck("higher Amazon price -> raw price lands at/above $10", high.rawSellingPrice >= 10, String(high.rawSellingPrice));

  // Every result must be internally self-consistent: whichever fee band was
  // used to compute the raw price must match the raw price's own bracket.
  [0.5, 1, 2, 5, 8, 9, 9.5, 9.9, 10, 10.5, 15, 30, 60, 120].forEach((amazonPrice) => {
    const raw = P.computeRawSellingPrice(amazonPrice, DEFAULT_SETTINGS);
    const under10Candidate = (amazonPrice * 1.08 * 1.15 + 0.3) / 0.795;
    const expected = under10Candidate < 10 ? under10Candidate : (amazonPrice * 1.08 * 1.15 + 0.4) / 0.795;
    const rounded = Math.round((expected + Number.EPSILON) * 100) / 100;
    ck(`self-consistent fee bracket for Amazon $${amazonPrice}`, Math.abs(raw - rounded) < 0.001, `${raw} vs ${rounded}`);
  });
}

console.log("\n[D] .49/.99 ending rule is untouched and still applied as its own separate step");
{
  ck("floor+0.99 branch", P.applyPriceEnding(12.80) === 12.99, String(P.applyPriceEnding(12.8)));
  ck("floor+0.49 branch", P.applyPriceEnding(12.50) === 12.49, String(P.applyPriceEnding(12.5)));
  ck("rolls down to prior dollar -1+0.99 branch", P.applyPriceEnding(12.10) === 11.99, String(P.applyPriceEnding(12.1)));
}

console.log("\n[E] Actual final profit is recalculated from the ACTUAL final (rounded) price, not the raw one");
{
  const calc = P.calculate(10, DEFAULT_SETTINGS);
  const manualActual = P.profitFor(calc.finalSellingPrice, 10, DEFAULT_SETTINGS);
  ck("actualProfit matches profitFor(finalSellingPrice, ...)", calc.actualProfit === manualActual);
  ck("actualProfit generally differs from expectedProfit once rounding shifts the price", calc.actualProfit !== calc.expectedProfit || calc.finalSellingPrice === calc.rawSellingPrice);
}

console.log("\n[F] Changing any one of the 4 settings changes the result (full reactivity)");
{
  const base = P.calculate(25, DEFAULT_SETTINGS);
  ck("taxRate changes the price", P.calculate(25, { ...DEFAULT_SETTINGS, taxRate: 15 }).finalSellingPrice !== base.finalSellingPrice);
  ck("targetProfit changes the price", P.calculate(25, { ...DEFAULT_SETTINGS, targetProfit: 30 }).finalSellingPrice !== base.finalSellingPrice);
  ck("finalValueFee changes the price", P.calculate(25, { ...DEFAULT_SETTINGS, finalValueFee: 25 }).finalSellingPrice !== base.finalSellingPrice);
  ck("promotedRate changes the price", P.calculate(25, { ...DEFAULT_SETTINGS, promotedRate: 20 }).finalSellingPrice !== base.finalSellingPrice);
}

console.log("\n[G] Degenerate fee configuration (>=100% total fees) never produces Infinity/NaN/negative");
{
  const extreme = P.calculate(20, { taxRate: 8, finalValueFee: 80, promotedRate: 30, targetProfit: 15 });
  ck("finite selling price", Number.isFinite(extreme.finalSellingPrice));
  ck("positive selling price", extreme.finalSellingPrice > 0);
}

console.log("\n[H] Amazon Price stays the sole driver — quantity rule (existing, unrelated) is untouched");
{
  ck("quantityFor(<36) is 5", P.quantityFor(35.99) === 5);
  ck("quantityFor(>=36) is 4", P.quantityFor(36) === 4);
}

console.log("\n[I] Advanced Pricing: range resolution by locked Amazon price");
{
  const settings = {
    pricing: DEFAULT_SETTINGS,
    advancedPricing: {
      enabled: true,
      thresholds: [10, 50],
      ranges: [
        { taxRate: 5, finalValueFee: 10, promotedRate: 5, targetProfit: 10 },
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 25 },
      ],
    },
  };
  ck("below first threshold -> range 0", P.resolvePricingSettings(5, settings).targetProfit === 10);
  ck("just below first threshold (9.99) -> range 0", P.resolvePricingSettings(9.99, settings).targetProfit === 10);
  ck("exactly at first threshold (10) -> range 1", P.resolvePricingSettings(10, settings).targetProfit === 15);
  ck("middle of range 1 (30) -> range 1", P.resolvePricingSettings(30, settings).targetProfit === 15);
  ck("just below second threshold (49.99) -> range 1", P.resolvePricingSettings(49.99, settings).targetProfit === 15);
  ck("exactly at second threshold (50) -> range 2", P.resolvePricingSettings(50, settings).targetProfit === 25);
  ck("well above second threshold (500) -> range 2", P.resolvePricingSettings(500, settings).targetProfit === 25);
}

console.log("\n[J] Advanced Pricing: disabled/blank/malformed always falls back to flat Pricing Settings");
{
  const flatOnly = { pricing: DEFAULT_SETTINGS };
  ck("no advancedPricing key at all -> flat settings", P.resolvePricingSettings(30, flatOnly) === DEFAULT_SETTINGS);

  const disabled = { pricing: DEFAULT_SETTINGS, advancedPricing: { enabled: false, thresholds: [10], ranges: [{ taxRate: 1 }] } };
  ck("enabled:false -> flat settings", P.resolvePricingSettings(30, disabled) === DEFAULT_SETTINGS);

  const blankRanges = { pricing: DEFAULT_SETTINGS, advancedPricing: { enabled: true, thresholds: [10], ranges: [] } };
  ck("enabled but no ranges configured -> flat settings", P.resolvePricingSettings(30, blankRanges) === DEFAULT_SETTINGS);

  const noRangesKey = { pricing: DEFAULT_SETTINGS, advancedPricing: { enabled: true } };
  ck("enabled but ranges key missing entirely -> flat settings", P.resolvePricingSettings(30, noRangesKey) === DEFAULT_SETTINGS);
}

console.log("\n[K] Advanced Pricing: end-to-end price actually differs per range when enabled");
{
  const settings = {
    pricing: DEFAULT_SETTINGS,
    advancedPricing: {
      enabled: true,
      thresholds: [20],
      ranges: [
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 5 }, // low target profit under $20
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 40 }, // high target profit at/above $20
      ],
    },
  };
  const cheapResolved = P.resolvePricingSettings(10, settings);
  const expensiveResolved = P.resolvePricingSettings(25, settings);
  const cheapCalc = P.calculate(10, cheapResolved);
  const expensiveCalc = P.calculate(25, expensiveResolved);
  const cheapWithFlat = P.calculate(10, DEFAULT_SETTINGS);
  ck(
    "an Amazon price in the low-target-profit range prices lower than it would under the flat 15% target",
    cheapCalc.finalSellingPrice < cheapWithFlat.finalSellingPrice,
    `${cheapCalc.finalSellingPrice} vs ${cheapWithFlat.finalSellingPrice}`,
  );
  ck("both ranges still produce a valid, finite price", Number.isFinite(cheapCalc.finalSellingPrice) && Number.isFinite(expensiveCalc.finalSellingPrice));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);

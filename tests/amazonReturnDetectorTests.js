/*
 * Tests for amazon/amazonReturnDetector.js — Amazon return-status detection
 * scoped to the active offer, classified by wording pattern rather than an
 * exact string match. Node-only; not loaded by the extension.
 *   run with:  node tests/amazonReturnDetectorTests.js
 */
const fs = require("fs");
const path = require("path");
const { h, install } = require("./domShim");

const BUILD = path.join(__dirname, "..");
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

function loadDetector(root) {
  install(root);
  global.window.AEB = {};
  new Function(fs.readFileSync(path.join(BUILD, "common", "domUtils.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "amazon", "amazonOfferScope.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "amazon", "amazonReturnDetector.js"), "utf8")).call(global.window);
  return global.window.AEB.amazonReturns;
}

function buyBoxWith(returnText) {
  return h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("div", { id: "return-policy-anchor" }, [h("span", { text: returnText })]),
  ]);
}

console.log("\n[A] Every wording example from the spec classifies correctly");
[
  ["FREE Returns", "RETURNABLE"],
  ["30-day refund/replacement", "RETURNABLE"],
  ["Returnable until Jan 31, 2027", "RETURNABLE"],
  ["30-day return", "RETURNABLE"],
  ["Non-returnable due to Food safety reasons", "NON_RETURNABLE"],
].forEach(([text, expected]) => {
  const R = loadDetector(buyBoxWith(text));
  ck(`"${text}" -> ${expected}`, R.detectReturnStatus() === expected, R.detectReturnStatus());
});

console.log("\n[B] NON_RETURNABLE is checked before RETURNABLE (substring trap)");
{
  // "Non-returnable" contains the literal substring "returnable" — must not
  // be misread as a returnable signal.
  const R = loadDetector(buyBoxWith("Non-returnable"));
  ck("classified as NON_RETURNABLE, not RETURNABLE", R.detectReturnStatus() === "NON_RETURNABLE");
}

console.log("\n[C] Dynamic listing counts are irrelevant to Amazon-side detection (no count involved here at all)");
{
  // Sanity: the Amazon-side detector only classifies wording, it never
  // depends on any kind of count suffix (that concern is purely eBay-side).
  const R = loadDetector(buyBoxWith("30-day return (see policy for details)"));
  ck("still classifies as RETURNABLE despite extra trailing text", R.detectReturnStatus() === "RETURNABLE");
}

console.log("\n[D] No return-related text anywhere in the offer scope -> UNKNOWN, never guessed");
{
  const root = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("span", { text: "Ships from Amazon.com, sold by Example Seller" }),
  ]);
  const R = loadDetector(root);
  ck("status is UNKNOWN", R.detectReturnStatus() === "UNKNOWN");
}

console.log("\n[E] No recognizable offer/price anchor at all -> UNKNOWN (never a page-wide fallback)");
{
  const root = h("div", {}, [h("div", { text: "Unrelated page content mentioning free returns elsewhere" })]);
  const R = loadDetector(root);
  ck("status is UNKNOWN when the offer itself can't be located", R.detectReturnStatus() === "UNKNOWN");
}

console.log("\n[F] Return text OUTSIDE the buy box (e.g. a footer policy link) never affects the result");
{
  const root = h("div", {}, [
    h("footer", {}, [h("a", { href: "/returns-policy", text: "Non-returnable items list" })]),
    h("div", { id: "desktop_buybox" }, [
      h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
      h("div", { id: "return-policy-anchor" }, [h("span", { text: "FREE Returns" })]),
    ]),
  ]);
  const R = loadDetector(root);
  ck("in-scope text wins regardless of unrelated out-of-scope mentions", R.detectReturnStatus() === "RETURNABLE");
}

console.log("\n[G] Falls back to the whole offer scope's text when no dedicated return element exists");
{
  const root = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("span", { text: "Returnable until Feb 28" }), // no id/class hint, just loose text in the buy box
  ]);
  const R = loadDetector(root);
  ck("still finds it via the whole-scope fallback", R.detectReturnStatus() === "RETURNABLE");
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);

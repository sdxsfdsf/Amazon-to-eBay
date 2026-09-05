/*
 * Tests for amazon/amazonPrimeDetector.js — Prime eligibility detection
 * scoped strictly to the active buy box, never a page-wide search. Node-only;
 * not loaded by the extension.
 *   run with:  node tests/amazonPrimeDetectorTests.js
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
  new Function(fs.readFileSync(path.join(BUILD, "amazon", "amazonPrimeDetector.js"), "utf8")).call(global.window);
  return global.window.AEB.amazonPrime;
}

console.log("\n[A] Prime badge (.a-icon-prime) inside the buy box -> PRIME");
{
  const root = h("div", { id: "centerCol" }, [
    h("div", { id: "desktop_buybox" }, [
      h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
      h("i", { class: "a-icon a-icon-prime" }),
    ]),
  ]);
  const A = loadDetector(root);
  ck("status is PRIME", A.detectPrimeStatus() === "PRIME");
}

console.log("\n[B] Buy box found, no Prime badge anywhere in it -> NON_PRIME");
{
  const root = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("span", { text: "Ships from Amazon" }),
  ]);
  const A = loadDetector(root);
  ck("status is NON_PRIME", A.detectPrimeStatus() === "NON_PRIME");
}

console.log("\n[C] No recognizable price anchor at all -> UNKNOWN (never guesses)");
{
  const root = h("div", {}, [h("div", { text: "Some unrelated page content" })]);
  const A = loadDetector(root);
  ck("status is UNKNOWN", A.detectPrimeStatus() === "UNKNOWN");
}

console.log("\n[D] 'Try Prime' text/link is explicitly excluded, even inside the buy box");
{
  const root = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("a", { "aria-label": "Try Prime", text: "Try Prime" }),
  ]);
  const A = loadDetector(root);
  ck("'Try Prime' alone does not count as a Prime badge", A.detectPrimeStatus() === "NON_PRIME");
}

console.log("\n[E] 'FREE delivery' / 'Ships from Amazon' text alone never counts as Prime");
{
  const root = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("span", { text: "FREE delivery Tomorrow if you order within 4 hrs" }),
    h("span", { text: "Ships from Amazon.com" }),
  ]);
  const A = loadDetector(root);
  ck("bare delivery/shipping text does not imply Prime", A.detectPrimeStatus() === "NON_PRIME");
}

console.log("\n[F] A Prime badge OUTSIDE the buy box (nav header, ads, recommendations) never counts");
{
  const root = h("div", {}, [
    h("nav", { id: "nav-main" }, [h("i", { class: "a-icon a-icon-prime" }), h("span", { text: "Try Prime" })]),
    h("div", { id: "sponsored-carousel" }, [h("i", { class: "a-icon a-icon-prime" })]),
    h("div", { id: "desktop_buybox" }, [h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$9.99" })])]),
  ]);
  const A = loadDetector(root);
  ck("out-of-scope Prime badges are ignored -> NON_PRIME, not PRIME", A.detectPrimeStatus() === "NON_PRIME");
}

console.log("\n[G] Exact accessible-name match ('Prime' / 'Amazon Prime') counts; partial text does not");
{
  const rootExact = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("span", { "aria-label": "Prime" }),
  ]);
  ck("aria-label exactly 'Prime' -> PRIME", loadDetector(rootExact).detectPrimeStatus() === "PRIME");

  const rootAmazonPrime = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("img", { alt: "Amazon Prime" }),
  ]);
  ck("alt exactly 'Amazon Prime' -> PRIME", loadDetector(rootAmazonPrime).detectPrimeStatus() === "PRIME");

  const rootPartial = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("span", { "aria-label": "Prime Video included" }),
  ]);
  ck("aria-label 'Prime Video included' is NOT an exact match -> NON_PRIME", loadDetector(rootPartial).detectPrimeStatus() === "NON_PRIME");
}

console.log("\n[H] Hidden badge does not count (must be visible, matching this codebase's isVisible discipline)");
{
  const root = h("div", { id: "desktop_buybox" }, [
    h("div", { id: "corePriceDisplay_desktop_feature_div" }, [h("span", { text: "$19.99" })]),
    h("i", { class: "a-icon a-icon-prime", __hidden: true }),
  ]);
  const A = loadDetector(root);
  ck("a hidden badge does not count -> NON_PRIME", A.detectPrimeStatus() === "NON_PRIME");
}

console.log("\n[I] Different price anchors are all recognized (matching amazonCapture.js's own price selectors)");
["#corePriceDisplay_desktop_feature_div", "#corePrice_feature_div", "#apex_desktop", "#price_inside_buybox", "#newBuyBoxPrice"].forEach(
  (sel) => {
    const id = sel.slice(1);
    const root = h("div", { id: "desktop_buybox" }, [h("div", { id }, [h("span", { text: "$5.00" })]), h("i", { class: "a-icon-prime" })]);
    const A = loadDetector(root);
    ck(`price anchor ${sel} is recognized`, A.detectPrimeStatus() === "PRIME");
  },
);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);

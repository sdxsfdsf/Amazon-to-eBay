/*
 * Tests for amazon/amazonDescriptionExtractor.js — specifically the boundary
 * rule: the eBay Description may only ever be built from ONE of the three
 * approved sources (Standalone Product Description / Product Details +
 * About this item / Top Highlights + About this item), and nothing else on
 * the page. Node-only; not loaded by the extension.
 *   run with:  node tests/amazonDescriptionExtractorTests.js
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

function loadExtractor(root) {
  install(root);
  global.window.AEB = { log: () => {} };
  new Function(fs.readFileSync(path.join(BUILD, "common", "domUtils.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "amazon", "amazonDescriptionExtractor.js"), "utf8")).call(
    global.window,
  );
  return global.window.AEB.amazonDescription;
}

/** Two-cell row Amazon renders as either a <tr>, a labelled div pair, or a dt/dd pair. */
const row = (label, value) => h("tr", {}, [h("td", { text: label }), h("td", { text: value })]);
const bullets = (...items) => items.map((t) => h("li", { text: t }));

console.log("\n[A] Standalone Product Description: captured alone, nothing else mixed in");
{
  const root = h("div", {}, [
    h("div", { id: "productDescription" }, [h("p", { text: "A rich standalone description of the product." })]),
    // Unrelated page content that must never leak in.
    h("div", { class: "customers-also-bought" }, [h("h3", { text: "Customers also bought" }), h("li", { text: "Unrelated other product" })]),
  ]);
  const A = loadExtractor(root);
  const data = A.extractDescriptionData();
  ck("sourceType is standalone", data.sourceType === "standalone", data.sourceType);
  ck("standalone text captured", data.standaloneText.includes("A rich standalone description"));
  ck("no attributes leaked in", data.attributes.length === 0);
  ck("no bullets leaked in", data.bullets.length === 0);
  ck("unrelated 'customers also bought' text never appears", !data.standaloneText.includes("Unrelated other product"));
}

console.log("\n[B] Product Details + About this item: the approved combination");
{
  const root = h("div", {}, [
    h("div", { id: "productOverview_feature_div" }, [row("Color", "Blue"), row("Material", "Cotton")]),
    h("div", { id: "feature-bullets" }, [
      h("span", { text: "About this item" }),
      h("ul", {}, bullets("Soft and comfortable", "Machine washable")),
    ]),
  ]);
  const A = loadExtractor(root);
  const data = A.extractDescriptionData();
  ck("sourceType is aboutThisItem", data.sourceType === "aboutThisItem", data.sourceType);
  ck("Product Details rows captured", data.attributes.length === 2);
  ck("About this item bullets captured", data.bullets.length === 2);
  ck("no standalone text mixed in", data.standaloneText === "");
}

console.log("\n[C] Top Highlights + About this item: the approved combination");
{
  const root = h("div", {}, [
    h("div", { id: "productFactsDesktop_feature_div" }, [h("span", { text: "Top Highlights" }), row("Brand", "Acme"), row("Size", "Large")]),
    h("div", { id: "featurebullets_feature_div" }, [
      h("span", { text: "About this item" }),
      h("ul", {}, bullets("Durable build quality")),
    ]),
  ]);
  const A = loadExtractor(root);
  const data = A.extractDescriptionData();
  ck("sourceType is topHighlights", data.sourceType === "topHighlights", data.sourceType);
  ck("Top Highlights rows captured", data.attributes.some((a) => a.label === "Size"));
  ck("Brand row is excluded by the existing blocklist", !data.attributes.some((a) => a.label.toLowerCase() === "brand"));
  ck("About this item bullets still combined in", data.bullets.length === 1);
}

console.log("\n[D] Boundary: Top Highlights climb must require REAL attribute rows, not just a stray <li> nearby");
{
  // The heading's ancestor contains an unrelated <li> (e.g. a nav list) but
  // no actual label/value rows anywhere near "Top Highlights" itself.
  const root = h("div", {}, [
    h("div", { class: "page-wrapper" }, [
      h("nav", {}, [h("ul", {}, [h("li", { text: "Unrelated nav link" })])]),
      h("div", { class: "small-widget" }, [h("span", { text: "Top Highlights" })]),
    ]),
  ]);
  const A = loadExtractor(root);
  const data = A.extractDescriptionData();
  ck("Top Highlights is NOT selected without real attribute rows", data.sourceType !== "topHighlights", data.sourceType);
  ck("the unrelated nav link never becomes an attribute or bullet", !data.attributes.length && !data.bullets.length);
}

console.log("\n[E] Boundary: a reliable About-this-item container wins over a noisier, unrelated heading-climb match");
{
  // The REAL "About this item" bullets live in the dedicated #feature-bullets
  // container (2 genuine bullets). Elsewhere on the page, an unrelated
  // "Frequently bought together" widget happens to share an ancestor with a
  // stray heading that also reads "About this item" (e.g. a mis-copied A/B
  // test fragment) and has MORE list items under it — that must not win just
  // because it has a higher raw bullet count.
  const root = h("div", {}, [
    h("div", { id: "feature-bullets" }, [
      h("span", { text: "About this item" }),
      h("ul", {}, bullets("Genuine bullet one", "Genuine bullet two")),
    ]),
    h("div", { class: "decoy-widget" }, [
      h("span", { text: "About this item" }),
      h("ul", {}, bullets("Frequently bought item A", "Frequently bought item B", "Frequently bought item C", "Frequently bought item D")),
    ]),
  ]);
  const A = loadExtractor(root);
  const about = A.findAboutThisItemContent();
  ck("the dedicated, reliable container wins despite fewer bullets", about.bullets.length === 2, JSON.stringify(about.bullets));
  ck("genuine bullets are the ones kept", about.bullets.includes("Genuine bullet one"));
  ck("the decoy's bullets are not mixed in", !about.bullets.some((b) => b.includes("Frequently bought")));
}

console.log("\n[F] Boundary: hidden content is only trusted inside one of the three approved containers");
{
  const hiddenDecoy = h("div", { class: "decoy", __hidden: true }, [
    h("span", { text: "About this item" }),
    h("ul", {}, bullets("Hidden unrelated marketing copy")),
  ]);
  const root = h("div", {}, [
    h("div", { id: "aplus" }, [hiddenDecoy]), // A+ content is NOT one of the three approved sources
  ]);
  const A = loadExtractor(root);
  ck("hidden content inside #aplus is NOT trusted", A.isUsableAmazonContent(hiddenDecoy) === false);
}

console.log("\n[G] Boundary: hidden content IS still trusted inside an approved container");
{
  const hiddenReal = h("div", { class: "collapsed-panel", __hidden: true }, [
    h("span", { text: "About this item" }),
    h("ul", {}, bullets("Real bullet inside a collapsed panel")),
  ]);
  const root = h("div", {}, [h("div", { id: "feature-bullets" }, [hiddenReal])]);
  const A = loadExtractor(root);
  ck("hidden content inside the real approved container IS trusted", A.isUsableAmazonContent(hiddenReal) === true);
}

console.log("\n[H] No approved source present at all -> nothing captured, not a fallback grab of random content");
{
  const root = h("div", {}, [
    h("div", { class: "reviews" }, [h("h3", { text: "Customer reviews" }), h("li", { text: "5 stars, great product" })]),
    h("div", { class: "sponsored" }, [h("span", { text: "Sponsored" }), h("li", { text: "Ad for something else" })]),
  ]);
  const A = loadExtractor(root);
  const data = A.extractDescriptionData();
  ck("sourceType is null", data.sourceType === null, data.sourceType);
  ck("nothing captured at all", !data.attributes.length && !data.bullets.length && !data.standaloneText);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);

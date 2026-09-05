/*
 * Safety tests for the imported Description / Item price / Quantity logic.
 * Node-only; not loaded by the extension (manifest.json does not reference tests/).
 *   run with:  node tests/fieldWriterSafetyTests.js
 */
const fs = require("fs");
const path = require("path");
const { h, install } = require("./domShim");

const BUILD = path.join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${extra ? " -- " + extra : ""}`);
  }
}
function loadWriter(root) {
  install(root);
  global.window.AEB = {};
  const src = fs.readFileSync(path.join(BUILD, "ebay", "ebayRealFieldWriter.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function(src).call(global.window);
  return global.window.AEB.ebayRealFieldWriter;
}

function descriptionPage({ realHeader = true } = {}) {
  return h("div", {}, [
    h("section", { class: "conditional-description-module" }, [
      h("h3", { text: "Conditional Description" }),
      h("textarea", { id: "cond-desc", "aria-label": "Conditional Description" }),
    ]),
    h("section", { class: "product-description" }, [
      h("h3", { text: "Product Description" }),
      h("div", { contenteditable: "true", id: "prod-desc" }),
    ]),
    h("section", {}, [h("h4", { text: "Description Settings" }), h("textarea", { id: "desc-settings" })]),
    ...(realHeader
      ? [
          h("section", { class: "summary__description" }, [
            h("h2", { text: "Description" }),
            h("div", {}, [h("div", { contenteditable: "true", id: "real-desc" })]),
          ]),
        ]
      : []),
  ]);
}

function listingPage({ pricingSection = true } = {}) {
  const labelled = (labelText, a) => h("label", { text: labelText }, [h("input", a)]);
  return h("div", {}, [
    h("section", {}, [
      h("h2", { text: "Promoted listings" }),
      labelled("Item price", { id: "promo-price", value: "0.00" }),
      labelled("Quantity", { id: "promo-qty", value: "0" }),
    ]),
    h("section", {}, [
      h("h2", { text: "Shipping" }),
      labelled("Shipping price", { id: "ship-price", value: "0.00" }),
      labelled("Package quantity", { id: "ship-qty", value: "0" }),
    ]),
    ...(pricingSection
      ? [
          h("section", {}, [
            h("h2", { text: "Pricing" }),
            h("div", {}, [
              labelled("Format", { id: "real-format", value: "Buy It Now" }),
              labelled("Item price", { id: "real-price", value: "" }),
              labelled("Recommended price", { id: "real-reco", value: "12.00" }),
              labelled("Quantity", { id: "real-qty", value: "" }),
              labelled("Sold quantity", { id: "real-sold", value: "3" }),
            ]),
          ]),
        ]
      : []),
    h("section", {}, [h("h2", { text: "Description" }), h("div", { contenteditable: "true", id: "desc" })]),
  ]);
}

async function main() {
  console.log("\n[1] Exact standalone 'Description' header rule");
  {
    const re = loadWriter(h("div")).EXACT_DESCRIPTION_HEADING_RE;
    ["Description", "description", "DESCRIPTION", "Description *", "Description:"].forEach((t) =>
      check(`accepts "${t}"`, re.test(t)),
    );
    [
      "Conditional Description",
      "Product Description",
      "Description Settings",
      "Item description",
      "Description and details",
      "Full Description",
      "Descriptions",
      "Seller Description Template",
    ].forEach((t) => check(`rejects "${t}"`, !re.test(t)));
  }

  console.log("\n[2] Description section targets the exact header only");
  {
    const w = loadWriter(descriptionPage({ realHeader: true }));
    check("section located", !w.findDescriptionSectionStrict().error);
    const e = w.findRealEbayDescriptionEditor();
    check("editor resolved", !e.error, e.error);
    check("targets real-desc", e.element && e.element.id === "real-desc", e.element && e.element.id);
    ["cond-desc", "prod-desc", "desc-settings"].forEach((id) =>
      check(`does NOT target ${id}`, !e.element || e.element.id !== id),
    );
  }

  console.log("\n[3] Decoy headers only -> refuse to write anywhere");
  {
    const w = loadWriter(descriptionPage({ realHeader: false }));
    const doc = global.document;
    check("DESCRIPTION_HEADER_NOT_FOUND", w.findDescriptionSectionStrict().error === "DESCRIPTION_HEADER_NOT_FOUND");
    const before = {
      cond: doc.getElementById("cond-desc").value,
      prod: doc.getElementById("prod-desc").textContent,
      set: doc.getElementById("desc-settings").value,
    };
    const res = await w.writeRealDescription("<p>About this item</p>", "About this item");
    check("write reports failure", res.ok === false);
    check("code is DESCRIPTION_HEADER_NOT_FOUND", res.code === "DESCRIPTION_HEADER_NOT_FOUND", res.code);
    check("Conditional Description untouched", doc.getElementById("cond-desc").value === before.cond);
    check("Product Description untouched", doc.getElementById("prod-desc").textContent === before.prod);
    check("Description Settings untouched", doc.getElementById("desc-settings").value === before.set);
  }

  console.log("\n[4] Positive description write under an exact 'Description' header");
  {
    const w = loadWriter(
      h("div", {}, [
        h("section", {}, [h("h3", { text: "Conditional Description" }), h("textarea", { id: "cond" })]),
        h("section", {}, [h("h2", { text: "Description" }), h("div", {}, [h("textarea", { id: "real-desc" })])]),
      ]),
    );
    const doc = global.document;
    const html = "<h3>About this item</h3><ul><li>Water resistant to 50m</li></ul>";
    const res = await w.writeRealDescription(html, "About this item");
    check("write verified", res.ok === true, JSON.stringify({ code: res.code }));
    check("real editor received the HTML", doc.getElementById("real-desc").value === html);
    check("Conditional Description still empty", doc.getElementById("cond").value === "");
    check("editor still editable", res.editable === true);
  }

  console.log("\n[5] PRICING section location and exact field targeting");
  {
    const w = loadWriter(listingPage());
    const container = w.findPricingContainer();
    check("PRICING container located", !!container);
    const p = w.locateInPricing("price");
    check("price target is real-price", p.element && p.element.id === "real-price", p.element && p.element.id);
    ["promo-price", "ship-price", "real-reco"].forEach((id) =>
      check(`price target is NOT ${id}`, !p.element || p.element.id !== id),
    );
    const q = w.locateInPricing("quantity");
    check("quantity target is real-qty", q.element && q.element.id === "real-qty", q.element && q.element.id);
    ["promo-qty", "ship-qty", "real-sold"].forEach((id) =>
      check(`quantity target is NOT ${id}`, !q.element || q.element.id !== id),
    );
    check("container excludes Description editor", !container.contains(global.document.getElementById("desc")));
    check("container excludes promoted price", !container.contains(global.document.getElementById("promo-price")));
  }

  console.log("\n[6] Verified writes land only in PRICING");
  {
    const w = loadWriter(listingPage());
    const doc = global.document;
    const snap = () => ({
      pp: doc.getElementById("promo-price").value,
      sp: doc.getElementById("ship-price").value,
      rc: doc.getElementById("real-reco").value,
      pq: doc.getElementById("promo-qty").value,
      sq: doc.getElementById("ship-qty").value,
      so: doc.getElementById("real-sold").value,
    });
    const before = snap();
    const pr = await w.writeRealPrice(24.99);
    check("price write verified", pr.ok === true, JSON.stringify(pr));
    check("Item price is 24.99", doc.getElementById("real-price").value === "24.99");
    check("price still editable", pr.editable === true);
    const qr = await w.writeRealQuantity(7);
    check("quantity write verified", qr.ok === true, JSON.stringify(qr));
    check("Quantity is 7", doc.getElementById("real-qty").value === "7");
    check("quantity still editable", qr.editable === true);
    const after = snap();
    Object.keys(before).forEach((k) => check(`decoy ${k} untouched`, before[k] === after[k]));
  }

  console.log("\n[7] No PRICING section -> abort, never fall back");
  {
    const w = loadWriter(listingPage({ pricingSection: false }));
    const doc = global.document;
    const b = { p: doc.getElementById("promo-price").value, s: doc.getElementById("ship-price").value };
    const pr = await w.writeRealPrice(99.99);
    check("price write fails", pr.ok === false);
    check("code PRICING_SECTION_NOT_FOUND", pr.code === "PRICING_SECTION_NOT_FOUND", pr.code);
    check("promoted price not used", doc.getElementById("promo-price").value === b.p);
    check("shipping price not used", doc.getElementById("ship-price").value === b.s);
    const qr = await w.writeRealQuantity(5);
    check("quantity write fails", qr.ok === false);
    check("code PRICING_SECTION_NOT_FOUND", qr.code === "PRICING_SECTION_NOT_FOUND", qr.code);
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}

main();

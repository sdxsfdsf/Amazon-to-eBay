/*
 * Tests for the reload self-healing behavior in ebay/ebayDescription.js:
 * detecting when the Description editor shows our own markup as literal,
 * escaped text (the "code became visible instead of the design" failure),
 * and the restoreIfNeeded() decision this feeds into. Node-only; not loaded
 * by the extension.
 *   run with:  node tests/descriptionReloadPersistenceTests.js
 */
const fs = require("fs");
const path = require("path");
const { h, install } = require("./domShim");
const D = require(path.join(__dirname, "..", "common", "descriptionBuilder.js"));

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

function loadModules(root) {
  install(root);
  global.window.AEB = {};
  new Function(fs.readFileSync(path.join(BUILD, "common", "domUtils.js"), "utf8")).call(global.window);
  global.window.AEB.description = D;
  new Function(fs.readFileSync(path.join(BUILD, "ebay", "ebayRealFieldWriter.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "ebay", "ebayDescription.js"), "utf8")).call(global.window);
  return global.window.AEB.ebayDescription;
}

/** A "Description" section wrapping a single editor element. */
function descriptionSection(editorChild) {
  return h("div", {}, [
    h("section", { class: "summary__description" }, [h("h2", { text: "Description" }), h("div", {}, [editorChild])]),
  ]);
}

const SAMPLE_DATA = {
  attributes: [{ label: "Color", value: "Midnight Blue" }],
  bullets: ["A great little bullet point about this item"],
  heading: "About this item",
};

(async () => {
  console.log("\n[K] editorShowsRawMarkup: properly rendered content is never flagged");
  {
    const editor = h("div", { contenteditable: "true", id: "real-desc" }, [
      h("div", { class: "aeb-listing" }, [
        h("h2", { text: "Product Details" }),
        h("span", { text: "Midnight Blue" }),
        h("h2", { text: "About this item" }),
        h("li", { text: "A great little bullet point about this item" }),
      ]),
    ]);
    const AEA = loadModules(descriptionSection(editor));
    ck("real rendered elements are not flagged as raw markup", AEA.editorShowsRawMarkup() === false);
    ck("verifyDescriptionContent finds the expected bullet text", AEA.verifyDescriptionContent(SAMPLE_DATA) === true);
  }

  console.log("\n[L] editorShowsRawMarkup: our own HTML showing as literal escaped text IS flagged");
  {
    // No element children at all — just a single text node whose content is
    // literally the markup source, exactly what "the code became visible"
    // looks like from the DOM's point of view.
    const editor = h("div", {
      contenteditable: "true",
      id: "real-desc",
      text: '<div class="aeb-listing"><h2>Product Details</h2></div>',
    });
    const AEA = loadModules(descriptionSection(editor));
    ck("literal escaped markup text IS flagged", AEA.editorShowsRawMarkup() === true);
  }

  console.log("\n[M] editorShowsRawMarkup: a raw-HTML-source textarea is exempt (that's its job)");
  {
    const editor = h("textarea", {
      id: "real-desc",
      "aria-label": "Description",
      value: '<div class="aeb-listing"><h2>Product Details</h2></div>',
    });
    const AEA = loadModules(descriptionSection(editor));
    ck("a textarea showing source is NOT flagged", AEA.editorShowsRawMarkup() === false);
  }

  console.log("\n[N] editorShowsRawMarkup: no Description section at all -> false, never throws");
  {
    const AEA = loadModules(h("div", {}, [h("section", {}, [h("h2", { text: "Shipping" })])]));
    let threw = false;
    let result;
    try {
      result = AEA.editorShowsRawMarkup();
    } catch {
      threw = true;
    }
    ck("returns false rather than throwing", threw === false && result === false);
  }

  console.log("\n[O] restoreIfNeeded: already-correct content is left alone (no attempt, no rewrite)");
  {
    const editor = h("div", { contenteditable: "true", id: "real-desc" }, [
      h("div", { class: "aeb-listing" }, [
        h("h2", { text: "Product Details" }),
        h("span", { text: "Midnight Blue" }),
        h("h2", { text: "About this item" }),
        h("li", { text: "A great little bullet point about this item" }),
      ]),
    ]);
    const AEA = loadModules(descriptionSection(editor));
    const before = editor.textContent;
    const res = await AEA.restoreIfNeeded(SAMPLE_DATA);
    ck("nothing was attempted", res.attempted === false);
    ck("editor content is untouched", editor.textContent === before);
  }

  console.log("\n[P] restoreIfNeeded: raw-markup-as-text is recognized as needing a restore attempt");
  {
    const editor = h("div", {
      contenteditable: "true",
      id: "real-desc",
      text: '<div class="aeb-listing"><h2>Product Details</h2></div>',
    });
    const AEA = loadModules(descriptionSection(editor));
    const res = await AEA.restoreIfNeeded(SAMPLE_DATA);
    ck("a restore was attempted", res.attempted === true, JSON.stringify(res));
  }

  console.log("\n[Q] restoreIfNeeded: nothing captured yet -> no-op, never throws");
  {
    const editor = h("div", { contenteditable: "true", id: "real-desc" });
    const AEA = loadModules(descriptionSection(editor));
    const res = await AEA.restoreIfNeeded(null);
    ck("no-op when there is no descriptionData to restore", res.attempted === false);
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();

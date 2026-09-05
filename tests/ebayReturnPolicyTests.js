/*
 * Tests for ebay/ebayReturnPolicy.js — locating the Returns section,
 * selecting the correct policy by NAME (ignoring a dynamic listing count),
 * verifying persistence, and the Amazon-status -> eBay-policy mapping that
 * refuses to guess on UNKNOWN. Node-only; not loaded by the extension.
 *   run with:  node tests/ebayReturnPolicyTests.js
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

function loadModules(root) {
  install(root);
  global.window.AEB = {};
  new Function(fs.readFileSync(path.join(BUILD, "common", "domUtils.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "ebay", "ebaySectionScanner.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "ebay", "ebayRealFieldWriter.js"), "utf8")).call(global.window);
  new Function(fs.readFileSync(path.join(BUILD, "ebay", "ebayReturnPolicy.js"), "utf8")).call(global.window);
  return global.window.AEB.ebayReturnPolicy;
}

/** A minimal but functionally-real <select>-like mock (options/selectedIndex/value all wired together). */
function mockSelect(optionLabels, initialIndex) {
  const options = optionLabels.map((label, i) => ({ value: String(i), textContent: label, tagName: "OPTION" }));
  return {
    tagName: "SELECT",
    isConnected: true,
    children: [],
    id: "",
    className: "",
    attrs: {},
    getAttribute() {
      return null;
    },
    closest() {
      return null;
    },
    options,
    selectedIndex: initialIndex,
    get value() {
      return options[this.selectedIndex] ? options[this.selectedIndex].value : "";
    },
    set value(v) {
      const idx = options.findIndex((o) => o.value === v);
      if (idx >= 0) this.selectedIndex = idx;
    },
    focus() {},
    click() {},
    select() {},
    blur() {},
    querySelectorAll: (sel) => (sel === "option" ? options : []),
    addEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
}

function returnsSectionWith(children) {
  return h("div", {}, [h("section", {}, [h("h2", { text: "Returns" }), h("div", {}, children)])]);
}

function loadModulesWithSelect(select, heading) {
  const root = h("div", {}, [h("section", {}, [h("h2", { text: heading || "Return policy" }), select])]);
  return loadModules(root);
}

(async () => {
  console.log("\n[A] No Returns section on the page -> RETURNS_SECTION_NOT_FOUND, nothing touched");
  {
    const root = h("div", {}, [h("section", {}, [h("h2", { text: "Shipping" })])]);
    const AER = loadModules(root);
    const res = await AER.selectReturnPolicy("30 Days Return");
    ck("code is RETURNS_SECTION_NOT_FOUND", res.code === "RETURNS_SECTION_NOT_FOUND", res.code);
    ck("reports failure", res.ok === false);
  }

  console.log("\n[B] Returns section found but no select/radio control inside it -> RETURN_POLICY_CONTROL_NOT_FOUND");
  {
    const root = returnsSectionWith([h("p", { text: "No editable control here" })]);
    const AER = loadModules(root);
    const res = await AER.selectReturnPolicy("30 Days Return");
    ck("code is RETURN_POLICY_CONTROL_NOT_FOUND", res.code === "RETURN_POLICY_CONTROL_NOT_FOUND", res.code);
  }

  console.log("\n[C] Radio-based control: selecting '30 Days Return' by its label, dynamic count stripped");
  {
    const radio30 = h("input", { type: "radio", id: "policy-30", name: "policy" });
    const radioNo = h("input", { type: "radio", id: "policy-no", name: "policy" });
    const root = returnsSectionWith([
      radio30,
      h("label", { for: "policy-30", text: "30 Days Return (1,259 listings)" }),
      radioNo,
      h("label", { for: "policy-no", text: "No Return" }),
    ]);
    const AER = loadModules(root);
    const res = await AER.selectReturnPolicy("30 Days Return");
    ck("reports success", res.ok === true, JSON.stringify(res));
    ck("the correct radio ended up checked", radio30.checked === true && radioNo.checked !== true);
    ck("actual (readback) matches the target, count stripped", res.actual === "30 Days Return", res.actual);
  }

  console.log("\n[D] Radio-based control: selecting 'No Return'");
  {
    const radio30 = h("input", { type: "radio", id: "policy-30", name: "policy" });
    const radioNo = h("input", { type: "radio", id: "policy-no", name: "policy" });
    const root = returnsSectionWith([
      radio30,
      h("label", { for: "policy-30", text: "30 Days Return (500 listings)" }),
      radioNo,
      h("label", { for: "policy-no", text: "No Return" }),
    ]);
    const AER = loadModules(root);
    const res = await AER.selectReturnPolicy("No Return");
    ck("reports success", res.ok === true, JSON.stringify(res));
    ck("the No Return radio ended up checked", radioNo.checked === true);
  }

  console.log("\n[E] Select-based control: option text carries the dynamic count, still matches by name");
  {
    const select = mockSelect(["No Return", "30 Days Return (1259 listings)", "60 Days Return"], 0);
    const AER = loadModulesWithSelect(select);
    const res = await AER.selectReturnPolicy("30 Days Return");
    ck("reports success", res.ok === true, JSON.stringify(res));
    ck("select's selectedIndex moved to the matching option", select.selectedIndex === 1);
    ck("actual (readback), count stripped, matches the target", res.actual === "30 Days Return", res.actual);
  }

  console.log("\n[F] Listing count changing between calls never breaks matching");
  {
    const select = mockSelect(["No Return", "30 Days Return (99999 listings)"], 0);
    const AER = loadModulesWithSelect(select, "Returns");
    const res = await AER.selectReturnPolicy("30 Days Return");
    ck("still matches despite a very different listing count", res.ok === true, JSON.stringify(res));
  }

  console.log("\n[G] applyReturnPolicyFromAmazonStatus: RETURNABLE -> '30 Days Return'");
  {
    const radio30 = h("input", { type: "radio", id: "policy-30" });
    const root = returnsSectionWith([radio30, h("label", { for: "policy-30", text: "30 Days Return (10 listings)" })]);
    const AER = loadModules(root);
    const res = await AER.applyReturnPolicyFromAmazonStatus("RETURNABLE");
    ck("selects 30 Days Return", res.ok === true && radio30.checked === true, JSON.stringify(res));
  }

  console.log("\n[H] applyReturnPolicyFromAmazonStatus: NON_RETURNABLE -> 'No Return'");
  {
    const radioNo = h("input", { type: "radio", id: "policy-no" });
    const root = returnsSectionWith([radioNo, h("label", { for: "policy-no", text: "No Return" })]);
    const AER = loadModules(root);
    const res = await AER.applyReturnPolicyFromAmazonStatus("NON_RETURNABLE");
    ck("selects No Return", res.ok === true && radioNo.checked === true, JSON.stringify(res));
  }

  console.log("\n[I] applyReturnPolicyFromAmazonStatus: UNKNOWN -> refuses, exact alert message, nothing touched");
  {
    const radio30 = h("input", { type: "radio", id: "policy-30" });
    const root = returnsSectionWith([radio30, h("label", { for: "policy-30", text: "30 Days Return" })]);
    const AER = loadModules(root);
    const res = await AER.applyReturnPolicyFromAmazonStatus("UNKNOWN");
    ck("reports failure", res.ok === false);
    ck("code names the Amazon-side cause", res.code === "AMAZON_RETURN_STATUS_UNKNOWN", res.code);
    ck("message is exactly the requested alert text", res.message === "Return policy not found on Amazon", res.message);
    ck("the eBay radio was never touched", radio30.checked !== true);
  }

  console.log("\n[J] A value with no mapping at all also refuses rather than guessing");
  {
    const root = returnsSectionWith([h("input", { type: "radio", id: "x" }), h("label", { for: "x", text: "30 Days Return" })]);
    const AER = loadModules(root);
    const res = await AER.applyReturnPolicyFromAmazonStatus("SOMETHING_UNRECOGNIZED");
    ck("still refuses safely", res.ok === false && res.code === "AMAZON_RETURN_STATUS_UNKNOWN");
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();

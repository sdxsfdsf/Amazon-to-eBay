/* Focused tests for complete normal Amazon prices. */
const fs = require("fs");
const path = require("path");

let candidates = [];
global.location = { pathname: "/dp/B012345678", href: "https://www.amazon.com/dp/B012345678" };
global.document = {
  querySelector: () => null,
  querySelectorAll: () => candidates,
};
global.window = {
  AEB: {
    txt: (el) => (el && el.textContent ? String(el.textContent).replace(/\s+/g, " ").trim() : ""),
    log() {},
    isVisible: (el) => el.visible !== false,
    waitFor: async (fn) => fn(),
  },
};

function priceNode({ text = "", offscreen = null, whole = null, fraction = null, visible = true } = {}) {
  return {
    isConnected: true,
    visible,
    textContent: text,
    matches: (selector) => selector === ".a-price",
    closest: () => null,
    getAttribute: () => null,
    querySelector(selector) {
      if (selector === ".a-offscreen") return offscreen == null ? null : { textContent: offscreen };
      if (selector === ".a-price-whole") return whole == null ? null : { textContent: whole };
      if (selector === ".a-price-fraction") return fraction == null ? null : { textContent: fraction };
      return null;
    },
  };
}

const code = fs.readFileSync(path.join(__dirname, "..", "amazon", "amazonCapture.js"), "utf8");
new Function(code).call(global.window);
const capture = window.AEB.amazonCapture;

function expect(label, actual, expected) {
  if (!Object.is(actual, expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
  console.log(`PASS ${label}`);
}

candidates = [priceNode({ offscreen: "$9.99" })];
expect("complete offscreen $9.99", capture.currentPrice(), 9.99);

candidates = [priceNode({ whole: "12", fraction: "57" })];
expect("same-container split $12.57", capture.currentPrice(), 12.57);

candidates = [priceNode({ whole: "12", fraction: null, text: "$12" })];
expect("missing cents are rejected, never changed to .00", capture.currentPrice(), null);

candidates = [priceNode({ offscreen: "$8.25", visible: false }), priceNode({ offscreen: "$14.73" })];
expect("hidden stale price skipped for visible price", capture.currentPrice(), 14.73);

expect("integer-only text is not a complete normal price", capture.parseCompletePrice("$19"), null);
console.log("==== 5 passed, 0 failed ====");

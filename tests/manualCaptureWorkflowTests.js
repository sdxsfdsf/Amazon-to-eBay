/* Verifies that automatic preparation remains private and only an explicit
   capture commit writes data/images for eBay. */
const fs = require("fs");
const path = require("path");

let storedImageCalls = 0;
let confirmedWrites = 0;
let liveTitle = "Prepared title";
const priceNode = {
  isConnected: true,
  textContent: "$9.99",
  matches: (selector) => selector === ".a-price",
  closest: () => null,
  getAttribute: () => null,
  querySelector: (selector) => (selector === ".a-offscreen" ? { textContent: "$9.99" } : null),
};

global.location = { pathname: "/dp/B012345678", href: "https://www.amazon.com/dp/B012345678" };
global.document = {
  querySelector(selector) {
    if (selector.includes("#ASIN")) return { value: "B012345678", getAttribute: () => null };
    if (selector.includes("#productTitle")) return { textContent: liveTitle };
    return null;
  },
  querySelectorAll(selector) {
    return selector.includes("price") || selector.includes("apex") ? [priceNode] : [];
  },
};
global.window = {
  AEB: {
    txt: (el) => (el && el.textContent ? el.textContent.trim() : ""),
    log() {},
    isVisible: () => true,
    waitFor: async (fn) => fn(),
    amazonDescription: {
      extractDescriptionData: () => ({ sourceType: "test", attributes: [], bullets: [] }),
      collectAttributeRows: () => [],
    },
    amazonImages: { collectCurrentVariantImages: () => ["https://images.example/live.jpg"] },
    amazonPrime: { detectPrimeStatus: () => "PRIME" },
    amazonReturns: { detectReturnStatus: () => "RETURNABLE" },
    imageStore: {
      storeImages: async () => {
        storedImageCalls += 1;
        return [{ key: "stored-image" }];
      },
    },
    setCapture: async () => {
      confirmedWrites += 1;
    },
  },
};

const code = fs.readFileSync(path.join(__dirname, "..", "amazon", "amazonCapture.js"), "utf8");
new Function(code).call(global.window);

(async () => {
  const prepared = window.AEB.amazonCapture.prepareCurrentVariant();
  if (prepared.title !== "Prepared title") throw new Error("background snapshot was not prepared");
  if (storedImageCalls !== 0 || confirmedWrites !== 0) throw new Error("preparation leaked into confirmed capture");

  // Proves the button-time path re-reads live data instead of committing the
  // earlier temporary snapshot.
  liveTitle = "Fresh title at click time";
  const confirmed = await window.AEB.amazonCapture.captureCurrentVariant();
  if (confirmed.title !== liveTitle) throw new Error("capture did not perform a fresh live recheck");
  if (storedImageCalls !== 1 || confirmedWrites !== 1) throw new Error("explicit capture did not commit exactly once");
  console.log("==== manual capture workflow: passed ====");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

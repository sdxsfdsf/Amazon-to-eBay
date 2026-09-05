/* Amazon image identity / dedupe tests. Node-only; not loaded by the extension.
   run with:  node tests/imageDedupeTests.js */
const fs = require("fs");
const path = require("path");
const P = (...p) => path.join(__dirname, "..", ...p);
const COLLECTOR = P("amazon", "amazonImageCollector.js");

let pass = 0, fail = 0;
const ck = (n, c, e) => (c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? " -- " + e : ""))));
const H = "https://m.media-amazon.com/images/I/";
const MAIN = "71abcDEF12", G2 = "81zzzQQQ99", G3 = "61mmmNNN00", G4 = "51pppRRR77";

function loadCollector(doc) {
  global.window = {};
  global.location = { href: "https://www.amazon.com/dp/B00MC5X94A" };
  global.document = doc || { querySelectorAll: () => [], querySelector: () => null };
  window.AEB = { log: () => {} };
  new Function(fs.readFileSync(COLLECTOR, "utf8")).call(window);
  return window.AEB.amazonImages;
}

/* Amazon exposes the SAME main asset in four places under four URL forms. */
function amazonDoc() {
  const script = { textContent: `P.when('A').register('ImageBlockATF', function(){
    var data = { 'colorImages': { 'initial': [
      {"hiRes":"${H}${MAIN}.jpg","thumb":"${H}${MAIN}._SS40_.jpg","large":"${H}${MAIN}._AC_SX679_.jpg","variant":"MAIN"},
      {"hiRes":"${H}${G2}.jpg","thumb":"${H}${G2}._SS40_.jpg","large":"${H}${G2}._AC_SX679_.jpg","variant":"PT01"},
      {"hiRes":"${H}${G3}.jpg","thumb":"${H}${G3}._SS40_.jpg","large":"${H}${G3}._AC_SX679_.jpg","variant":"PT02"},
      {"hiRes":null,"thumb":"${H}${G4}._SS40_.jpg","large":"${H}${G4}._AC_SX679_.jpg","variant":"PT03"}
    ] } }; });` };
  const mainImg = {
    getAttribute: (a) => ({
      "data-a-dynamic-image": JSON.stringify({
        [H + MAIN + "._AC_SX425_.jpg"]: [425, 425],
        [H + MAIN + ".__AC_SX679_SY679_QL70_FMwebp_.jpg"]: [679, 679],
      }),
      "data-old-hires": H + MAIN + ".jpg",
    }[a] ?? null),
    currentSrc: H + MAIN + "._AC_SX425_.jpg",
    src: H + MAIN + "._AC_SX425_.jpg",
  };
  const li = (id) => ({
    classList: { contains: () => false }, className: "",
    querySelector: (s) => (s === "img" ? { currentSrc: H + id + "._AC_US40_.jpg", src: H + id + "._AC_US40_.jpg" } : null),
  });
  const thumbRoot = { querySelectorAll: (s) => (s === "li" ? [li(MAIN), li(G2), li(G3), li(G4)] : []) };
  return {
    querySelectorAll: (s) => (s === "script" ? [script] : []),
    querySelector: (s) => {
      if (s.includes("imgTagWrapperId")) return mainImg;
      if (s === "#altImages ul") return thumbRoot;
      return null;
    },
  };
}

console.log("\n[G] Every URL-size variant of one asset normalizes to the same original");
{
  const A = loadCollector();
  const variants = [
    H + MAIN + ".jpg", H + MAIN + "._AC_SL1500_.jpg", H + MAIN + "._AC_SX679_.jpg",
    H + MAIN + ".__AC_SX300_SY300_QL70_FMwebp_.jpg", H + MAIN + "._SS40_.jpg",
    H + MAIN + "._AC_US40_.jpg", H + MAIN + "._AC_SX679_SY679_.jpg",
    "https://images-na.ssl-images-amazon.com/images/I/" + MAIN + "._SL1000_.jpg",
    H + MAIN + "._AC_SL1500_.jpg?x=1",
  ];
  variants.forEach((v) => ck("normalizes " + v.slice(H.length), new RegExp(MAIN + "\\.jpg$").test(A.toOriginalUrl(v) || ""), A.toOriginalUrl(v)));
  ck(`all ${variants.length} variants share ONE identity`, new Set(variants.map((u) => A.identityOf(A.toOriginalUrl(u)))).size === 1);
  ck("different assets stay distinct", new Set([H + MAIN + ".jpg", H + G2 + "._AC_SL1500_.jpg", H + G3 + "._SS40_.jpg"].map((u) => A.identityOf(A.toOriginalUrl(u)))).size === 3);
  ck("rejects non-Amazon host", A.toOriginalUrl("https://evil.example.com/images/I/" + MAIN + ".jpg") === null);
}

console.log("\n[H] Full collection: main image reachable from 4 sources");
{
  const A = loadCollector(amazonDoc());
  const out = A.collectCurrentVariantImages();
  out.forEach((u, i) => console.log(`      ${i}: ${u.slice(H.length)}`));
  const idOf = (u) => u.split("/").pop().split(".")[0].toLowerCase();
  const ids = out.map(idOf);
  ck("main image appears exactly ONCE", ids.filter((x) => x === MAIN.toLowerCase()).length === 1, JSON.stringify(ids));
  ck("main image is FIRST", ids[0] === MAIN.toLowerCase(), ids[0]);
  ck("no duplicate identities", new Set(ids).size === ids.length, JSON.stringify(ids));
  ck("all 4 distinct gallery assets kept", new Set(ids).size === 4);
  ck("remaining images in normal order", JSON.stringify(ids.slice(1)) === JSON.stringify([G2, G3, G4].map((x) => x.toLowerCase())), JSON.stringify(ids.slice(1)));
  ck("every URL is the original (no size modifier)", out.every((u) => /\/I\/[^./]+\.(jpe?g|png|webp|gif)$/.test(u)));
}

console.log("\n[I] Positional safety net: the strip's first thumbnail is dropped once the main image");
console.log("    is already known elsewhere — even if that thumbnail carries a genuinely DIFFERENT");
console.log("    identity string (identity matching alone would keep it as a false 5th image)");
{
  const THUMB_DECOY = "99decoyMAINTHUMB1"; // Amazon serving a distinct derived filename for the SAME picture
  const script = {
    textContent: `P.when('A').register('ImageBlockATF', function(){
    var data = { 'colorImages': { 'initial': [
      {"hiRes":"${H}${MAIN}.jpg","thumb":"${H}${THUMB_DECOY}._SS40_.jpg","large":"${H}${MAIN}._AC_SX679_.jpg","variant":"MAIN"},
      {"hiRes":"${H}${G2}.jpg","thumb":"${H}${G2}._SS40_.jpg","large":"${H}${G2}._AC_SX679_.jpg","variant":"PT01"}
    ] } }; });`,
  };
  const mainImg = {
    getAttribute: (a) => ({ "data-old-hires": H + MAIN + ".jpg" }[a] ?? null),
    currentSrc: H + MAIN + ".jpg",
    src: H + MAIN + ".jpg",
  };
  const li = (id) => ({
    classList: { contains: () => false },
    className: "",
    querySelector: (s) => (s === "img" ? { currentSrc: H + id + "._AC_US40_.jpg", src: H + id + "._AC_US40_.jpg" } : null),
  });
  // The strip's FIRST entry is the decoy (Amazon's real-world behaviour:
  // thumbnail 0 mirrors the main image), followed by G2's genuine thumbnail.
  const thumbRoot = { querySelectorAll: (s) => (s === "li" ? [li(THUMB_DECOY), li(G2)] : []) };
  const doc = {
    querySelectorAll: (s) => (s === "script" ? [script] : []),
    querySelector: (s) => {
      if (s.includes("imgTagWrapperId")) return mainImg;
      if (s === "#altImages ul") return thumbRoot;
      return null;
    },
  };
  const A = loadCollector(doc);
  const out = A.collectCurrentVariantImages();
  const idOf = (u) => u.split("/").pop().split(".")[0].toLowerCase();
  const ids = out.map(idOf);
  ck("the decoy thumbnail identity never appears at all", !ids.includes(THUMB_DECOY.toLowerCase()), JSON.stringify(ids));
  ck("main image still appears exactly once", ids.filter((x) => x === MAIN.toLowerCase()).length === 1, JSON.stringify(ids));
  ck("main image is still first", ids[0] === MAIN.toLowerCase());
  ck("the genuinely distinct G2 gallery image is kept", ids.includes(G2.toLowerCase()));
  ck("exactly 2 images total (decoy dropped, not added as a false 3rd)", ids.length === 2, JSON.stringify(ids));
}

console.log("\n[J] Without any other main-image source, the first thumbnail is kept as-is");
console.log("    (nothing else to corroborate it against, so there's nothing safe to drop)");
{
  const li = (id) => ({
    classList: { contains: () => false },
    className: "",
    querySelector: (s) => (s === "img" ? { currentSrc: H + id + "._AC_US40_.jpg", src: H + id + "._AC_US40_.jpg" } : null),
  });
  const thumbRoot = { querySelectorAll: (s) => (s === "li" ? [li(MAIN), li(G2)] : []) };
  const doc = {
    querySelectorAll: () => [], // no colorImages script at all
    querySelector: (s) => (s === "#altImages ul" ? thumbRoot : null), // and no hero <img> found either
  };
  const A = loadCollector(doc);
  const out = A.collectCurrentVariantImages();
  const idOf = (u) => u.split("/").pop().split(".")[0].toLowerCase();
  const ids = out.map(idOf);
  ck("both thumbnails kept when there's no other source to corroborate", ids.length === 2, JSON.stringify(ids));
  ck("first thumbnail (MAIN) still present", ids.includes(MAIN.toLowerCase()));
}



console.log("\n[K] Gallery larger than six: full colorImages model wins over six rendered thumbnails");
{
  const ids10 = Array.from({ length: 10 }, (_, i) => `${i === 0 ? MAIN : `7${i}fullGalleryAsset${i}`}`);
  const entries = ids10.map((id, i) => `{"hiRes":"${H}${id}.jpg","large":"${H}${id}._AC_SX679_.jpg","variant":"PT${String(i).padStart(2, "0")}"}`).join(",");
  const script = { textContent: `P.when('A').register('ImageBlockATF',function(){var data={'colorImages':{'initial':[${entries}]}};});` };
  const mainImg = {
    getAttribute: (a) => ({ "data-old-hires": H + MAIN + ".jpg" }[a] ?? null),
    currentSrc: H + MAIN + ".jpg", src: H + MAIN + ".jpg",
  };
  const li = (id) => ({
    classList: { contains: () => false }, className: "",
    querySelector: (q) => (q === "img" ? { getAttribute: () => null, currentSrc: H + id + "._SS40_.jpg", src: H + id + "._SS40_.jpg" } : null),
  });
  // Amazon only renders six thumbnails in the compact strip.
  const thumbRoot = { querySelectorAll: (q) => (q === "li" ? ids10.slice(0, 6).map(li) : []) };
  const doc = {
    querySelectorAll: (q) => (q === "script" ? [script] : []),
    querySelector: (q) => {
      if (q.includes("imgTagWrapperId")) return mainImg;
      if (q === "#altImages ul") return thumbRoot;
      return null;
    },
  };
  const A = loadCollector(doc);
  const out = A.collectCurrentVariantImages();
  ck("captures all 10 images even though only 6 thumbnails are rendered", out.length === 10, JSON.stringify(out));
  ck("all 10 are unique", new Set(out.map((u) => A.identityOf(u))).size === 10);
  ck("main remains first", A.identityOf(out[0]) === MAIN.toLowerCase());
}

console.log("\n[L] Does not stop at the first ImageBlockATF script if that script has no gallery data");
{
  const ids8 = [MAIN, "81later2", "81later3", "81later4", "81later5", "81later6", "81later7", "81later8"];
  const noise = { textContent: "P.when('A').register('ImageBlockATF', function(){ /* bootstrap only */ });" };
  const entries = ids8.map((id) => `{"hiRes":"${H}${id}.jpg","large":"${H}${id}._AC_SX679_.jpg"}`).join(",");
  const real = { textContent: `var x={"colorImages":{"initial":[${entries}]}};` };
  const mainImg = { getAttribute: (a) => ({ "data-old-hires": H + MAIN + ".jpg" }[a] ?? null), currentSrc: H + MAIN + ".jpg", src: H + MAIN + ".jpg" };
  const li = (id) => ({ classList: { contains: () => false }, className: "", querySelector: (q) => (q === "img" ? { getAttribute: () => null, currentSrc: H + id + "._SS40_.jpg", src: H + id + "._SS40_.jpg" } : null) });
  const thumbRoot = { querySelectorAll: (q) => (q === "li" ? ids8.slice(0, 6).map(li) : []) };
  const doc = {
    querySelectorAll: (q) => (q === "script" ? [noise, real] : []),
    querySelector: (q) => {
      if (q.includes("imgTagWrapperId")) return mainImg;
      if (q === "#altImages ul") return thumbRoot;
      return null;
    },
  };
  const A = loadCollector(doc);
  const out = A.collectCurrentVariantImages();
  ck("later script supplies all 8 images", out.length === 8, JSON.stringify(out));
}



console.log("\n[M] Multiple variant galleries: choose only the group containing the current hero");
{
  const blue = ["71blueMain", "71blue2", "71blue3", "71blue4", "71blue5", "71blue6", "71blue7", "71blue8"];
  const red = ["71redMain", "71red2", "71red3", "71red4", "71red5", "71red6", "71red7", "71red8", "71red9"];
  const mk = (ids) => ids.map((id) => `{"hiRes":"${H}${id}.jpg","large":"${H}${id}._AC_SX679_.jpg"}`).join(",");
  const script = { textContent: `var data={"colorImages":{"initial":[${mk(blue)}],"Red":[${mk(red)}]}};` };
  const current = red[0];
  const mainImg = { getAttribute: (a) => ({ "data-old-hires": H + current + ".jpg" }[a] ?? null), currentSrc: H + current + ".jpg", src: H + current + ".jpg" };
  const li = (id) => ({ classList: { contains: () => false }, className: "", querySelector: (q) => (q === "img" ? { getAttribute: () => null, currentSrc: H + id + "._SS40_.jpg", src: H + id + "._SS40_.jpg" } : null) });
  const thumbRoot = { querySelectorAll: (q) => (q === "li" ? red.slice(0, 6).map(li) : []) };
  const doc = {
    querySelectorAll: (q) => (q === "script" ? [script] : []),
    querySelector: (q) => {
      if (q.includes("imgTagWrapperId")) return mainImg;
      if (q === "#altImages ul") return thumbRoot;
      return null;
    },
  };
  const A = loadCollector(doc);
  const out = A.collectCurrentVariantImages();
  const got = out.map((u) => A.identityOf(u));
  ck("captures all 9 current-red images", got.length === 9, JSON.stringify(got));
  ck("does not mix blue variant images", !got.some((id) => id.includes("blue")), JSON.stringify(got));
  ck("current red hero remains first", got[0] === current.toLowerCase(), got[0]);
}


console.log("\n[N] Same 8 visual gallery images exposed under different model-vs-DOM asset ids must NOT become 16");
{
  const model = [MAIN, "91model2", "91model3", "91model4", "91model5", "91model6", "91model7", "91model8"];
  const dom = [MAIN, "92dom2", "92dom3", "92dom4", "92dom5", "92dom6", "92dom7", "92dom8"];
  const entries = model.map((id) => `{"hiRes":"${H}${id}.jpg","large":"${H}${id}._AC_SX679_.jpg"}`).join(",");
  const script = { textContent: `var x={"colorImages":{"initial":[${entries}]}};` };
  const mainImg = {
    getAttribute: (a) => ({ "data-old-hires": H + MAIN + ".jpg" }[a] ?? null),
    currentSrc: H + MAIN + ".jpg", src: H + MAIN + ".jpg",
  };
  const li = (id) => ({
    classList: { contains: () => false }, className: "",
    querySelector: (q) => (q === "img" ? { getAttribute: () => null, currentSrc: H + id + "._SS40_.jpg", src: H + id + "._SS40_.jpg" } : null),
  });
  const thumbRoot = { querySelectorAll: (q) => (q === "li" ? dom.map(li) : []) };
  const doc = {
    querySelectorAll: (q) => (q === "script" ? [script] : []),
    querySelector: (q) => {
      if (q.includes("imgTagWrapperId")) return mainImg;
      if (q === "#altImages ul") return thumbRoot;
      return null;
    },
  };
  const A = loadCollector(doc);
  const out = A.collectCurrentVariantImages();
  const got = out.map((u) => A.identityOf(u));
  ck("returns exactly 8 images, not model 8 + DOM 8", got.length === 8, JSON.stringify(got));
  ck("uses one authoritative gallery source rather than merging identities", got.every((id) => model.map((x) => x.toLowerCase()).includes(id)), JSON.stringify(got));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);

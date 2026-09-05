/* global window */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { txt, log } = AEB;

  function currentAsin() {
    const selectors = [
      "#ASIN",
      "input[name='ASIN']",
      "input#ASIN.a-state",
      "[data-asin][data-csa-c-asin]",
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      const v = el && (el.value || el.getAttribute("data-asin"));
      if (v && /^[A-Z0-9]{10}$/.test(v)) return v;
    }
    const state = document.querySelector("#twister-plus-inline-twister, #twisterJsInitializer");
    if (state) {
      const m = (state.textContent || "").match(/"asin"\s*:\s*"([A-Z0-9]{10})"/);
      if (m) return m[1];
    }
    const m2 = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    return m2 ? m2[1] : null;
  }

  function currentTitle() {
    const el = document.querySelector("#productTitle, #title span");
    return txt(el);
  }

  function parsePrice(s) {
    const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
    return m ? Number(m[1]) : null;
  }

  function currentPrice() {
    const offscreen = document.querySelector(
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #apex_desktop .a-price .a-offscreen",
    );
    if (offscreen) {
      const p = parsePrice(offscreen.textContent);
      if (p) return p;
    }
    const whole = document.querySelector("#corePriceDisplay_desktop_feature_div .a-price-whole");
    const frac = document.querySelector("#corePriceDisplay_desktop_feature_div .a-price-fraction");
    if (whole) return parsePrice(`${txt(whole)}.${txt(frac) || "00"}`);
    const alt = document.querySelector("#price_inside_buybox, #newBuyBoxPrice, .priceToPay .a-offscreen");
    return alt ? parsePrice(txt(alt)) : null;
  }

  function currentAttributes() {
    const rows = AEB.amazonDescription.collectAttributeRows(
      document.querySelector("#productOverview_feature_div") ||
        document.querySelector("#productFactsDesktopExpander"),
    );
    return rows;
  }

  /** Full, variant-scoped capture. Always rebuilt from scratch — never merged with stale data. */
  async function captureCurrentVariant() {
    const asin = currentAsin();
    const descriptionData = AEB.amazonDescription.extractDescriptionData();
    const imageUrls = AEB.amazonImages.collectCurrentVariantImages();
    // Re-derived fresh on every capture (never reused from a previous
    // variant) — the whole point of rebuilding this object from scratch.
    const primeStatus = AEB.amazonPrime.detectPrimeStatus();
    const returnStatus = AEB.amazonReturns.detectReturnStatus();
    const capture = {
      captureId: asin || `url:${location.pathname}`,
      asin,
      title: currentTitle(),
      price: currentPrice(),
      attributes: currentAttributes(),
      descriptionData,
      imageUrls,
      images: [],
      primeStatus,
      returnStatus,
      sourceUrl: location.href,
      capturedAt: Date.now(),
    };
    capture.images = await AEB.imageStore.storeImages(capture.captureId, imageUrls);
    await AEB.setCapture(capture);
    log("Amazon Capture", {
      ASIN: asin,
      Price: capture.price,
      Images: capture.images.length,
      "Description source": descriptionData.sourceType,
      Attributes: (descriptionData.attributes || []).length,
      Bullets: (descriptionData.bullets || []).length,
      Prime: primeStatus,
      Returns: returnStatus,
    });
    return capture;
  }

  AEB.amazonCapture = { captureCurrentVariant, currentAsin, currentPrice, currentTitle, parsePrice };
})();

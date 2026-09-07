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

  /** Normal Amazon prices are accepted only when both decimal digits exist. */
  function parseCompletePrice(s) {
    const normalized = String(s || "").replace(/\u00a0/g, " ").trim();
    const m = normalized.match(/(?:US\$|USD|\$)?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(?!\d)/i);
    if (!m) return null;
    const value = Number(`${m[1].replace(/,/g, "")}.${m[2]}`);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function isVisiblePriceNode(node) {
    if (!node || !node.isConnected) return false;
    const priceBox = node.matches && node.matches(".a-price") ? node : node.closest && node.closest(".a-price");
    const visibleNode = priceBox || node;
    return typeof AEB.isVisible !== "function" || AEB.isVisible(visibleNode);
  }

  /** Reads a complete price from one price box; whole/fraction never mix across boxes. */
  function priceFromNode(node) {
    if (!node || !isVisiblePriceNode(node)) return null;
    if (node.closest && node.closest(".basisPrice, .a-text-price, [data-a-strike='true']")) return null;

    const offscreen = node.querySelector && node.querySelector(".a-offscreen");
    const accessible = parseCompletePrice(offscreen && offscreen.textContent);
    if (accessible != null) return accessible;

    const ariaPrice = parseCompletePrice(node.getAttribute && node.getAttribute("aria-label"));
    if (ariaPrice != null) return ariaPrice;

    const whole = node.querySelector && node.querySelector(".a-price-whole");
    const fraction = node.querySelector && node.querySelector(".a-price-fraction");
    const wholeDigits = txt(whole).replace(/[^\d,]/g, "");
    const fractionDigits = txt(fraction).replace(/\D/g, "");
    if (wholeDigits && /^\d{2}$/.test(fractionDigits)) {
      return parseCompletePrice(`${wholeDigits}.${fractionDigits}`);
    }

    return parseCompletePrice(node.textContent);
  }

  function currentPrice() {
    const selectors = [
      "#corePriceDisplay_desktop_feature_div .priceToPay",
      "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price)",
      "#corePrice_feature_div .priceToPay",
      "#corePrice_feature_div .a-price:not(.a-text-price)",
      "#apex_desktop .priceToPay",
      "#apex_desktop .a-price:not(.a-text-price)",
      "#price_inside_buybox",
      "#newBuyBoxPrice",
    ];
    const seen = new Set();
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        const price = priceFromNode(node);
        if (price != null) return price;
      }
    }
    return null;
  }

  async function waitForCurrentPrice({ timeout = 3500, interval = 100 } = {}) {
    return AEB.waitFor(() => currentPrice(), { timeout, interval });
  }

  function currentAttributes() {
    const rows = AEB.amazonDescription.collectAttributeRows(
      document.querySelector("#productOverview_feature_div") ||
        document.querySelector("#productFactsDesktopExpander"),
    );
    return rows;
  }

  // Latest live Amazon snapshot prepared in this tab only. It is deliberately
  // never written to chrome.storage, so eBay cannot use it before the user
  // explicitly confirms it with the Capture Product button.
  let preparedCapture = null;

  function prepareCurrentVariant() {
    const asin = currentAsin();
    const descriptionData = AEB.amazonDescription.extractDescriptionData();
    const imageUrls = AEB.amazonImages.collectCurrentVariantImages();
    const primeStatus = AEB.amazonPrime.detectPrimeStatus();
    const returnStatus = AEB.amazonReturns.detectReturnStatus();
    preparedCapture = {
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
      preparedAt: Date.now(),
    };
    return preparedCapture;
  }

  /**
   * The only commit path. A fresh live snapshot is rebuilt at click time so a
   * staged snapshot from an earlier variant can never be confirmed by mistake.
   */
  async function captureCurrentVariant() {
    let capture = prepareCurrentVariant();
    if (capture.price == null) {
      await waitForCurrentPrice();
      // Rebuild every field after waiting so a variant change during the wait
      // can never mix the earlier product with the newly loaded price.
      capture = prepareCurrentVariant();
    }
    if (capture.price == null) {
      const error = new Error("AMAZON_PRICE_NOT_READY");
      error.code = "AMAZON_PRICE_NOT_READY";
      throw error;
    }
    capture.capturedAt = Date.now();
    capture.images = await AEB.imageStore.storeImages(capture.captureId, capture.imageUrls);
    await AEB.setCapture(capture);
    log("Amazon Capture", {
      ASIN: capture.asin,
      Price: capture.price,
      Images: capture.images.length,
      "Description source": capture.descriptionData.sourceType,
      Attributes: (capture.descriptionData.attributes || []).length,
      Bullets: (capture.descriptionData.bullets || []).length,
      Prime: capture.primeStatus,
      Returns: capture.returnStatus,
    });
    return capture;
  }

  function getPreparedCapture() {
    return preparedCapture;
  }

  AEB.amazonCapture = {
    prepareCurrentVariant,
    getPreparedCapture,
    captureCurrentVariant,
    currentAsin,
    currentPrice,
    waitForCurrentPrice,
    currentTitle,
    parsePrice,
    parseCompletePrice,
  };
})();

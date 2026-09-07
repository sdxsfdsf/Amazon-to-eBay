/* global window, MutationObserver */
/* Detects variant/child-ASIN changes and refreshes only the tab-local prepared
   snapshot. Confirmed capture data is changed exclusively by the button. */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { debounce, log } = AEB;

  function signature() {
    const asin = AEB.amazonCapture.currentAsin();
    const price = AEB.amazonCapture.currentPrice();
    const main = document.querySelector("#imgTagWrapperId img, #landingImage");
    const img = main ? main.currentSrc || main.src : "";
    const selected = Array.from(
      document.querySelectorAll(
        "#twister .swatchSelect, #twister .a-button-selected, .inline-twister-swatch.swatch-select, [aria-checked='true'][data-csa-c-element-id]",
      ),
    )
      .map((el) => (el.getAttribute("title") || el.textContent || "").trim())
      .join("|");
    return [asin, price, img, selected].join("##");
  }

  function start(onChange) {
    let last = null;
    const check = debounce(async () => {
      const sig = signature();
      if (sig === last) return;
      last = sig;
      log("Amazon Variant", { changed: true });
      const prepared = AEB.amazonCapture.prepareCurrentVariant();
      onChange(prepared);
    }, 500);

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "class", "aria-checked", "value", "data-asin"],
    });
    document.addEventListener("click", check, true);
    window.addEventListener("popstate", check);
    check();
    return () => observer.disconnect();
  }

  AEB.amazonVariantObserver = { start, signature };
})();

/* global window */
(function () {
  const AEB = window.AEB;

  async function init() {
    if (window.__aebAmazonInit) return;
    window.__aebAmazonInit = true;

    const panel = await AEB.panel.createPanel({
      mode: "amazon",
      buttons: [
        {
          label: "Capture Product",
          primary: true,
          onClick: async () => {
            let capture;
            try {
              capture = await AEB.amazonCapture.captureCurrentVariant();
            } catch (error) {
              if (error && (error.code === "AMAZON_PRICE_NOT_READY" || error.message === "AMAZON_PRICE_NOT_READY")) {
                panel.setStatus("Amazon price is not fully loaded. Please wait and click Capture Product again.", "err");
                return;
              }
              throw error;
            }
            await panel.refreshMeta();
            const d = capture.descriptionData || {};
            const diag = d.diagnostics || {};
            // No ASIN at all means the product itself couldn't be identified —
            // a real failure, not just an incomplete Description. A found
            // product with a noted gap in its Description — or an
            // undetermined Prime status — is neither a clean success nor a
            // failure, so it stays neutral rather than green.
            const primeUnknown = capture.primeStatus === "UNKNOWN";
            const kind = !capture.asin ? "err" : diag.incompleteReason || primeUnknown ? "neutral" : "ok";
            panel.setStatus(
              [
                `Captured ${capture.asin || "variant"}`,
                `price ${capture.price ? `$${capture.price.toFixed(2)}` : "unknown"}`,
                `images ${capture.images.length}`,
                `Description source: ${d.sourceType || "none"}`,
                `Product Details: ${(d.attributes || []).length}`,
                `About bullets: ${(d.bullets || []).length}`,
                `Prime: ${capture.primeStatus}`,
                `Returns: ${capture.returnStatus}`,
                diag.incompleteReason ? `INCOMPLETE: ${diag.incompleteReason}` : "",
                // The exact, explicit alert the user asked for — never silently
                // folded into the generic status text above.
                primeUnknown ? "Prime status could not be determined" : "",
              ]
                .filter(Boolean)
                .join(", "),
              kind,
            );
          },
        },
      ],
      onAction: () => {},
    });

    AEB.amazonVariantObserver.start((prepared) => {
      if (prepared && prepared.asin) {
        panel.setMetaMessage(`Ready: ${prepared.asin} · click Capture Product to confirm`);
      }
    });
  }

  init();
})();

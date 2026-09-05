/* global window */
(function () {
  const AEB = window.AEB;

  // ============================================================================
  // RE-ENTRANCY PROTECTION: Prevent multiple concurrent Prompt scans
  // ============================================================================

  let activePromptOperation = null; // Generation ID of currently-running Prompt

  async function currentCapture() {
    const capture = await AEB.getCapture();
    return capture;
  }

  async function copyAction(actionId, panel) {
    const capture = await currentCapture();
    if (!capture) {
      panel.setStatus("No Amazon variant captured. Open the Amazon product page first.", "err");
      return;
    }

    const data = capture.descriptionData || {};

    // Simple copy actions (not re-entrancy sensitive)
    if (actionId === "title") {
      const ok = await AEB.copyRich(AEB.description.buildTitleHTML(capture.title), capture.title || "");
      panel.setStatus(ok ? "Title copied" : "Copy failed", ok ? "ok" : "err");
      return;
    }

    if (actionId === "description") {
      const ok = await AEB.copyRich(
        AEB.description.buildDescriptionHTML(data),
        AEB.description.buildDescriptionPlainText(data),
      );
      panel.setStatus(ok ? "Description copied" : "Copy failed", ok ? "ok" : "err");
      return;
    }

    if (actionId === "titleDescription") {
      const ok = await AEB.copyRich(
        AEB.description.buildTitleAndDescriptionHTML(capture.title, data),
        AEB.description.buildTitleAndDescriptionPlainText(capture.title, data),
      );
      panel.setStatus(ok ? "Title & Description copied" : "Copy failed", ok ? "ok" : "err");
      return;
    }

    // ========================================================================
    // PROMPT ACTION: Use snapshot-based approach with bounded refresh
    // ========================================================================

    // Guard: Prevent multiple concurrent Prompt operations
    const operationId = Date.now() + Math.random();
    if (activePromptOperation) {
      // Ignore duplicate click (already running)
      return;
    }
    activePromptOperation = operationId;

    try {
      // Step 1: Try to use current valid snapshot immediately
      let itemSpecifics = AEB.ebayItemSpecifics.getSnapshotForPrompt();

      if (!itemSpecifics) {
        // Step 2: Snapshot is stale; show status and do bounded refresh
        panel.setTempStatus("Updating Item Specifics…", 3000, "neutral");
        itemSpecifics = await AEB.ebayItemSpecifics.refreshSnapshotIfStale();

        // Fall back to empty if refresh also failed
        if (!itemSpecifics) {
          itemSpecifics = { suggested: [], required: [], suggestedExpected: false, requiredExpected: false };
        }
      }

      // Step 3: Build and copy Prompt immediately (no long delay)
      const prompt = AEB.description.buildPrompt({
        title: capture.title,
        descriptionData: data,
        suggested: itemSpecifics.suggested || [],
        required: itemSpecifics.required || [],
      });

      const ok = await AEB.copyText(prompt);
      const suggested = itemSpecifics.suggested || [];
      const required = itemSpecifics.required || [];
      panel.setStatus(
        ok ? `Prompt copied (suggested: ${suggested.length}, required: ${required.length})` : "Copy failed",
        ok ? "ok" : "err",
      );
    } finally {
      // Clear re-entrancy guard
      if (activePromptOperation === operationId) {
        activePromptOperation = null;
      }
    }
  }

  /** { lines, kind } — kind is "ok" only if every enabled sub-task succeeded. */
  async function fillDetails(panel, { silent = false } = {}) {
    const capture = await currentCapture();
    if (!capture) {
      if (!silent) panel.setStatus("No Amazon variant captured. Open the Amazon product page first.", "err");
      return null;
    }
    const settings = await AEB.getSettings();
    const calc = AEB.pricing.calculate(
      capture.price || 0,
      AEB.pricing.resolvePricingSettings(capture.price || 0, settings),
    );
    const lines = [];
    let attempted = false;
    let anyFailed = false;

    if (settings.autoFill.description) {
      attempted = true;
      const res = await AEB.ebayDescription.injectRichDescription(capture.descriptionData || {});
      if (!res.ok) anyFailed = true;
      lines.push(res.ok ? "Description: verified" : `Description: ${res.message || res.code}`);
    }
    if (settings.autoFill.sellingPrice) {
      attempted = true;
      const res = await AEB.ebayPricing.fillItemPrice(calc.finalSellingPrice);
      if (!res.ok) anyFailed = true;
      lines.push(res.ok ? `Selling Price: $${calc.finalSellingPrice.toFixed(2)}` : `Selling Price: ${res.code}`);
    }
    if (settings.autoFill.quantity) {
      attempted = true;
      const res = await AEB.ebayPricing.fillQuantity(calc.quantity);
      if (!res.ok) anyFailed = true;
      lines.push(res.ok ? `Quantity: ${calc.quantity}` : `Quantity: ${res.code}`);
    }
    if (settings.autoFill.returnPolicy) {
      attempted = true;
      const res = await AEB.ebayReturnPolicy.applyReturnPolicyFromAmazonStatus(capture.returnStatus);
      if (!res.ok) anyFailed = true;
      lines.push(res.ok ? `Return Policy: ${res.actual}` : `Return Policy: ${res.message || res.code}`);
    }
    const kind = !attempted ? "neutral" : anyFailed ? "err" : "ok";
    if (!silent) panel.setStatus(lines.join(", ") || "Nothing enabled in Auto Fill Settings", kind);
    return { lines, kind };
  }

  /** { line, kind }. */
  async function uploadImages(panel, { silent = false } = {}) {
    const capture = await currentCapture();
    if (!capture) {
      if (!silent) panel.setStatus("No Amazon variant captured. Open the Amazon product page first.", "err");
      return null;
    }
    if (!silent) panel.setTempStatus("Uploading images…", 120000, "neutral");
    // Pass the captured variant URLs so the store can re-fetch the SAME variant
    // images if the blob cache was evicted. Never mixes in other variants.
    const res = await AEB.ebayPhotos.uploadImages(capture.captureId, capture.imageUrls || []);
    const line = res.ok
      ? `Images: ${res.verified}/${res.submitted} uploaded`
      : res.code === "IMAGE_UPLOAD_VERIFICATION_INCOMPLETE"
        ? "Images: upload submitted but could not be fully verified"
        : res.code === "IMAGE_UPLOAD_ALREADY_IN_PROGRESS"
          ? "Images: upload already in progress"
          : `Images: ${res.code}`;
    const kind = res.ok ? "ok" : "err";
    if (!silent) panel.setStatus(line, kind);
    return { line, kind };
  }

  /**
   * Best-effort, silent check that runs once per page load: if a Description
   * was already captured and the "Description" auto-fill is enabled, make
   * sure the eBay editor still shows it correctly rendered. eBay can
   * re-serialize a saved Description when the page reloads; when that
   * degrades the result (blank, or the raw markup showing as visible text),
   * this re-applies the very same content so the shopper-facing page never
   * depends on that round trip having gone cleanly. Never overrides a
   * Description the user chose to keep the extension out of.
   */
  async function restoreDescriptionOnLoad(panel) {
    try {
      const settings = await AEB.getSettings();
      if (!settings.autoFill.description) return;
      const capture = await currentCapture();
      if (!capture || !capture.descriptionData) return;
      const res = await AEB.ebayDescription.restoreIfNeeded(capture.descriptionData);
      if (res && res.attempted && res.ok) panel.setStatus("Description restored", "ok");
    } catch {
      /* best-effort; never blocks or breaks the panel */
    }
  }

  async function init() {
    if (window.__aebEbayInit) return;
    window.__aebEbayInit = true;

    // Initialize Item Specifics observer (background auto-invalidation on DOM changes)
    AEB.ebayItemSpecifics.initializeObserver();

    // Initial snapshot scan
    await AEB.ebayItemSpecifics.refreshSnapshotIfStale();

    const panel = await AEB.panel.createPanel({
      mode: "ebay",
      onAction: (actionId) => copyAction(actionId, panel),
      buttons: [
        { label: "Fill Details", onClick: () => fillDetails(panel) },
        { label: "Upload Image", onClick: () => uploadImages(panel) },
        {
          label: "Fill Item Specs",
          onClick: () => panel.setTempStatus("Item Specs autofill — Upcoming", 3000, "neutral"),
        },
        {
          label: "Auto Fill All",
          primary: true,
          onClick: async () => {
            const capture = await currentCapture();
            if (!capture) {
              panel.setStatus("No Amazon variant captured. Open the Amazon product page first.", "err");
              return;
            }
            panel.setTempStatus("Auto Fill All running…", 90000, "neutral");

            // Start the single image-upload operation first, but do NOT block
            // Description / Pricing / Quantity / Returns while eBay's photo
            // gallery is asynchronously verifying the upload. Submission and
            // verification are intentionally separate concerns: the uploader
            // still submits the image batch only once and keeps its no-retry
            // safeguards, while the rest of Auto Fill All can continue.
            const imagePromise = uploadImages(panel, { silent: true });
            const detailResult = await fillDetails(panel, { silent: true });
            const imageResult = await imagePromise;

            const lines = [imageResult ? imageResult.line : null, ...((detailResult && detailResult.lines) || [])].filter(
              Boolean,
            );
            const anyErr = (imageResult && imageResult.kind === "err") || (detailResult && detailResult.kind === "err");
            const anyOk = (imageResult && imageResult.kind === "ok") || (detailResult && detailResult.kind === "ok");
            const kind = anyErr ? "err" : anyOk ? "ok" : "neutral";
            panel.setStatus(["Completed", ...lines, "Listing was NOT published."].filter(Boolean).join(", "), kind);
          },
        },
      ],
    });

    // Fire-and-forget: never delays panel startup, never surfaces an error of
    // its own — fillDetails/Auto Fill All remain the explicit, user-triggered
    // way to (re)write the Description on demand.
    restoreDescriptionOnLoad(panel);
  }

  init();
})();

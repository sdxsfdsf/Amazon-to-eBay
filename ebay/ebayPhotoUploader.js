/* global window, DataTransfer, MutationObserver */
/* Real uploads through eBay's own file input; single-submission with fail-safe verification. */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { isVisible, sleep, log } = AEB;

  const IMAGE_ACCEPT = /image|\.jpe?g|\.png|\.webp|\.heic/i;
  const UI_IMG = /placeholder|icon|sprite|logo|spinner|loading|blank|add-photo|camera|\/v1\/ui|stock-photo/i;
  const MAX_COUNTER_DENOMINATORS = new Set([24, 25]);
  let activeUpload = null;

  function photoSection() {
    return AEB.ebaySections.findPhotoSection();
  }

  /** eBay's real input is often visually hidden; never require visibility here. */
  function fileInputsIn(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll("input[type='file']")).filter(
      (i) => !i.disabled && (!i.accept || IMAGE_ACCEPT.test(i.accept)),
    );
  }

  function score(input) {
    let s = 0;
    if (input.multiple) s += 4;
    if (input.accept && IMAGE_ACCEPT.test(input.accept)) s += 3;
    const ctx = `${input.id || ""} ${input.name || ""} ${input.className || ""} ${
      input.getAttribute("aria-label") || ""
    } ${(input.closest("[class]") || {}).className || ""}`;
    if (/photo|image|picture|upload|media/i.test(ctx)) s += 3;
    if (/video/i.test(ctx)) s -= 5;
    return s;
  }

  /** Photo-section inputs first, then document-wide — eBay sometimes renders the input outside the card. */
  function findEbayImageUploader() {
    const inSection = fileInputsIn(photoSection());
    const pool = inSection.length ? inSection : fileInputsIn(document);
    if (!pool.length) return null;
    return pool.slice().sort((a, b) => score(b) - score(a))[0];
  }

  /**
   * eBay currently exposes an authoritative-looking gallery counter such as
   * "13/25" inside Photos & Video. Prefer that over thumbnail timing because
   * React can accept files before every <img> has rendered.
   */
  function galleryCounter(root) {
    if (!root) return null;
    const text = String(root.innerText || root.textContent || "").replace(/\s+/g, " ");
    const matches = [...text.matchAll(/(?:^|[^0-9])(\d{1,2})\s*\/\s*(\d{1,2})(?=$|[^0-9])/g)];
    const plausible = matches
      .map((m) => ({ current: Number(m[1]), max: Number(m[2]) }))
      .filter((x) => MAX_COUNTER_DENOMINATORS.has(x.max) && x.current >= 0 && x.current <= x.max);
    if (!plausible.length) return null;
    return plausible.sort((a, b) => b.current - a.current)[0].current;
  }

  function uploadedSrcs(root = photoSection() || document) {
    if (!root) return new Set();
    const imgs = Array.from(root.querySelectorAll("img")).filter((img) => {
      const src = img.currentSrc || img.src || "";
      if (!/^(https?:|blob:|data:)/i.test(src)) return false;
      if (UI_IMG.test(src)) return false;
      if (!isVisible(img)) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 24 && r.height >= 24;
    });
    return new Set(imgs.map((i) => (i.currentSrc || i.src).split("?")[0]));
  }

  /**
   * Stable count for verification. Do NOT blindly trust the visible n/24 or
   * n/25 counter: on eBay that text can lag behind the photo cards after the
   * files have already been accepted/rendered. That was the reason a visually
   * complete first upload could remain stuck in verification.
   *
   * We therefore cross-check the counter with the unique rendered photo
   * sources inside the Photos section and use the strongest observed count.
   * This function is verification-only; it never triggers a retry/resubmit.
   */
  function gallerySnapshot() {
    const root = photoSection() || document;
    const explicit = galleryCounter(root);
    const imageCount = uploadedSrcs(root).size;

    if (explicit == null) return { count: imageCount, source: "images", counter: null, images: imageCount };
    if (imageCount === 0) return { count: explicit, source: "counter", counter: explicit, images: 0 };

    const count = Math.max(explicit, imageCount);
    const source = explicit === imageCount ? "counter+images" : count === imageCount ? "images" : "counter";
    return { count, source, counter: explicit, images: imageCount };
  }

  function countUploaded() {
    return gallerySnapshot().count;
  }

  /**
   * Compare LIKE WITH LIKE. A stale eBay counter at baseline must never be
   * subtracted from a later rendered-image count (for example baseline
   * counter=1, images=0 -> final counter=1, images=7). Each signal gets its
   * own delta and verification uses the strongest independent evidence.
   */
  function galleryDelta(baseline, current) {
    const deltas = [];
    if (baseline && baseline.counter != null && current && current.counter != null) {
      deltas.push(Math.max(0, current.counter - baseline.counter));
    }
    if (baseline && baseline.images != null && current && current.images != null) {
      deltas.push(Math.max(0, current.images - baseline.images));
    }
    if (!deltas.length) {
      deltas.push(Math.max(0, (current && current.count ? current.count : 0) - (baseline && baseline.count ? baseline.count : 0)));
    }
    return Math.max(...deltas);
  }

  function makeTransfer(files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    return dt;
  }

  /**
   * PRIMARY submission path. Important: this function uses exactly ONE
   * mechanism — input.files + input/change. It never also dispatches drop.
   *
   * Assignment is validated BEFORE dispatch. After change is dispatched,
   * input.files is deliberately not used as acceptance evidence because eBay
   * can immediately re-render/reset the input while retaining the FileList in
   * its own handler.
   */
  function submitViaInput(input, files) {
    if (!input || !input.isConnected) return { ok: false, code: "IMAGE_INPUT_DISCONNECTED", dispatched: false };
    try {
      const dt = makeTransfer(files);
      input.files = dt.files;
      const assigned = input.files ? Array.from(input.files).length : 0;
      if (assigned !== files.length) {
        return { ok: false, code: "FILE_ASSIGNMENT_REJECTED", dispatched: false, assigned };
      }
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return { ok: true, dispatched: true, assigned };
    } catch {
      return { ok: false, code: "FILE_ASSIGNMENT_REJECTED", dispatched: false, assigned: 0 };
    }
  }

  /** Wake on DOM mutation when possible, with a short polling fallback. */
  function waitForGalleryChange(root, timeoutMs) {
    if (typeof MutationObserver !== "function" || !root || !root.isConnected) return sleep(timeoutMs);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      const observer = new MutationObserver(finish);
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
      const timer = setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Verification only. This function NEVER submits or retries files.
   * It waits for eBay's gallery to catch up and returns what can actually be
   * established from the settled UI.
   */
  async function waitForVerification(baseline, expectedAdded, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    let best = 0;
    let last = -1;
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      const snap = gallerySnapshot();
      const added = galleryDelta(baseline, snap);
      best = Math.max(best, added);
      if (added >= expectedAdded) {
        return { complete: true, verified: expectedAdded, observed: added, source: snap.source };
      }

      if (added !== last) {
        last = added;
        stableSince = Date.now();
      }

      // Do not turn a short-lived partial thumbnail count into a retry. Keep
      // observing while the upload UI is still settling; verification failure
      // is reported only after the overall deadline.
      const root = photoSection() || document;
      await waitForGalleryChange(root, 1000);

      // A long stable partial state is still "uncertain", not proof that the
      // unseen files failed. We intentionally continue to the deadline so a
      // slow eBay upload can finish without being resubmitted.
      void stableSince;
    }

    const finalSnap = gallerySnapshot();
    const finalAdded = Math.max(best, galleryDelta(baseline, finalSnap));
    return { complete: finalAdded >= expectedAdded, verified: Math.min(finalAdded, expectedAdded), observed: finalAdded, source: finalSnap.source };
  }

  /**
   * Safe fallback for a proven PRE-DISPATCH bulk assignment failure only.
   * Because the rejected bulk FileList was never dispatched, sending each
   * file once here cannot race a previously-started bulk upload.
   */
  async function submitOneByOne(files) {
    let submitted = 0;
    for (const file of files) {
      const target = findEbayImageUploader();
      if (!target) return { ok: false, code: "IMAGE_UPLOADER_NOT_FOUND", submitted };
      const res = submitViaInput(target, [file]);
      if (!res.ok) return { ok: false, code: res.code, submitted };
      submitted += 1;
      // Yield so eBay has a chance to re-render/rebind the input before the
      // next file; the next iteration always reacquires the live element.
      await sleep(0);
    }
    return { ok: true, submitted };
  }

  async function performUpload(captureId, fallbackUrls) {
    const input = findEbayImageUploader();
    if (!input) return { ok: false, code: "IMAGE_UPLOADER_NOT_FOUND", submitted: 0, verified: 0 };

    const files = await AEB.imageStore.getFiles(captureId, fallbackUrls);
    if (!files.length) return { ok: false, code: "NO_CAPTURED_IMAGES", submitted: 0, verified: 0 };

    const baseline = gallerySnapshot();
    let submitted = 0;
    let mode = "batch";

    // If the live input explicitly does not support multiple files, do not
    // attempt a doomed bulk assignment. Submit each source file exactly once.
    if (input.multiple === false && files.length > 1) {
      mode = "single-file-input";
      const singles = await submitOneByOne(files);
      if (!singles.ok) return { ok: false, code: singles.code, submitted: singles.submitted, verified: 0 };
      submitted = singles.submitted;
    } else {
      const primary = submitViaInput(input, files);
      if (primary.ok) {
        submitted = files.length;
      } else if (!primary.dispatched) {
        // Safe fallback is allowed only because the batch never reached an
        // input/change event. No file from the failed bulk attempt was
        // submitted to eBay.
        mode = "single-file-fallback";
        const singles = await submitOneByOne(files);
        if (!singles.ok) return { ok: false, code: singles.code, submitted: singles.submitted, verified: 0 };
        submitted = singles.submitted;
      } else {
        return { ok: false, code: primary.code || "IMAGE_SUBMISSION_FAILED", submitted: 0, verified: 0 };
      }
    }

    const verificationTimeout = Number(AEB.__imageVerificationTimeoutMs) > 0 ? Number(AEB.__imageVerificationTimeoutMs) : 60000;
    const verification = await waitForVerification(baseline, files.length, verificationTimeout);
    log("eBay Images", {
      Captured: files.length,
      Submitted: submitted,
      Verified: verification.verified,
      ObservedDelta: verification.observed,
      VerificationSource: verification.source,
      Mode: mode,
    });

    if (!verification.complete) {
      return {
        ok: false,
        code: "IMAGE_UPLOAD_VERIFICATION_INCOMPLETE",
        message: "Image upload submitted but could not be fully verified",
        submitted,
        verified: verification.verified,
        observed: verification.observed,
        mode,
      };
    }

    return { ok: true, submitted, verified: files.length, observed: verification.observed, mode };
  }

  /**
   * Single reliable uploader used by BOTH "Upload Image" and "Auto Fill All".
   * An in-flight guard prevents overlapping button actions from starting a
   * second submission while the first one is still being verified. A later
   * manual click works normally after the current operation finishes.
   */
  async function uploadImages(captureId, fallbackUrls) {
    if (activeUpload) {
      return { ok: false, code: "IMAGE_UPLOAD_ALREADY_IN_PROGRESS", submitted: 0, verified: 0 };
    }
    activeUpload = performUpload(captureId, fallbackUrls);
    try {
      return await activeUpload;
    } finally {
      activeUpload = null;
    }
  }

  AEB.ebayPhotos = {
    findEbayImageUploader,
    uploadImages,
    countUploaded,
    gallerySnapshot,
    submitFiles: submitViaInput,
  };
})();

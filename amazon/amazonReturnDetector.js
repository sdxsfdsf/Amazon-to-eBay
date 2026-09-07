/* global window */
/*
 * Amazon return/refund status detection for the CURRENT selected variant.
 *
 * Scoped to the active offer (see amazonOfferScope.js) — the same buy-box
 * region Amazon renders its return-policy line in, never a page-wide
 * search. Wording varies a lot ("FREE Returns", "30-day refund/replacement",
 * "Returnable until...", "Non-returnable due to Food safety reasons", ...),
 * so this classifies by pattern rather than an exact-string match.
 *
 * Result is one of:
 *   RETURNABLE      — a clear returnable/return-window signal was found.
 *   NON_RETURNABLE  — a clear non-returnable signal was found.
 *   UNKNOWN         — no confident signal either way; never guessed.
 *
 * NON_RETURNABLE is checked BEFORE RETURNABLE on purpose: "Non-returnable"
 * contains the substring "returnable", so checking the returnable pattern
 * first would misclassify it.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { txt } = AEB;

  const NON_RETURNABLE_RX = /\bnon[- ]returnable\b|\bnot\s+returnable\b|\bno\s+returns?\b(?!\s+needed)/i;
  const RETURNABLE_RX =
    /\bfree\s+returns?\b|\breturnable\b|\beligible\s+for\s+returns?\b|\breturn\s*(?:\/|or)\s*(?:refund|replace|exchange)|\brefund\s*(?:\/|or)\s*replace|\b\d+[\s-]*day[\s\S]{0,20}\b(?:return|refund|replace)/i;

  /** Prefer a dedicated returns-related element if one exists within the offer scope. */
  function findReturnCandidateText(scope) {
    if (!scope) return "";
    const dedicated = scope.querySelector("[id*='return'], [class*='return'], a[href*='returns']");
    if (dedicated) {
      const t = txt(dedicated);
      if (t) return t;
    }
    // Fall back to the whole (still buy-box-scoped) region's text.
    return txt(scope);
  }

  function classifyReturnText(text) {
    const t = String(text || "");
    if (!t.trim()) return "UNKNOWN";
    if (NON_RETURNABLE_RX.test(t)) return "NON_RETURNABLE";
    if (RETURNABLE_RX.test(t)) return "RETURNABLE";
    return "UNKNOWN";
  }

  /**
   * RETURNABLE / NON_RETURNABLE / UNKNOWN for the CURRENT selected variant.
   * Re-derived from the live DOM at call time during both temporary
   * preparation and explicit Capture Product confirmation.
   */
  function detectReturnStatus() {
    const scope = AEB.amazonOffer.currentOfferScope();
    if (!scope) return "UNKNOWN";
    return classifyReturnText(findReturnCandidateText(scope));
  }

  AEB.amazonReturns = { detectReturnStatus, classifyReturnText, findReturnCandidateText };
})();

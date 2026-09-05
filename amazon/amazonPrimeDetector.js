/* global window */
/*
 * Prime-eligibility detection for the CURRENT selected variant/active offer.
 *
 * Scoped strictly to the active buy box (see amazonOfferScope.js): never a
 * page-wide text search for the word "Prime". "Try Prime" links, the
 * nav/header Prime entry, ads, recommended-product carousels, bare "FREE
 * delivery" or "Ships from Amazon" text are all outside this scope by
 * construction, and none of them alone satisfy the badge match even if
 * they were in scope.
 *
 * Result is one of:
 *   PRIME       — a real Prime badge/logo was found inside the active offer.
 *   NON_PRIME   — the active offer was found and searched, no badge present.
 *   UNKNOWN     — the active offer itself could not be confidently located;
 *                 never guessed at from surrounding page content.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { isVisible } = AEB;

  /**
   * A real Prime badge/logo inside `scope`. Matches Amazon's own stable
   * `.a-icon-prime` badge class first; otherwise an icon/image whose
   * accessible name is EXACTLY "Prime" or "Amazon Prime" — never a partial
   * match, so "Try Prime", "Prime Video", or a sentence merely mentioning
   * Prime never counts.
   */
  function findPrimeBadgeIn(scope) {
    if (!scope || !scope.querySelectorAll) return null;
    const iconMatch = scope.querySelector(".a-icon-prime, i[class*='icon-prime'], [class*='prime-logo']");
    if (iconMatch && isVisible(iconMatch)) return iconMatch;

    const candidates = Array.from(scope.querySelectorAll("[aria-label], img[alt]"));
    const exact = candidates.find((el) => {
      const label = (el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim();
      return /^(amazon )?prime$/i.test(label);
    });
    return exact && isVisible(exact) ? exact : null;
  }

  /**
   * PRIME / NON_PRIME / UNKNOWN for the CURRENT selected variant. Always
   * re-derived from the live DOM at call time — callers must not cache this
   * across a variant change; amazonCapture.js's captureCurrentVariant()
   * calls this fresh on every capture, which already happens on every
   * variant change (never reused from a previous variant).
   */
  function detectPrimeStatus() {
    const scope = AEB.amazonOffer.currentOfferScope();
    if (!scope) return "UNKNOWN";
    return findPrimeBadgeIn(scope) ? "PRIME" : "NON_PRIME";
  }

  AEB.amazonPrime = { detectPrimeStatus, findPrimeBadgeIn };
})();

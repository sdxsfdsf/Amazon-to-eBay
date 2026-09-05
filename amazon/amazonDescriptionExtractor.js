/* global window */
/*
 * Section-scoped Amazon Description extraction.
 * Exactly three approved capture methods:
 *   1. standalone   — a real product Description container
 *   2. aboutThisItem — structured Product Details + About this item bullets
 *   3. topHighlights — modern Top Highlights rows + About this item bullets
 *
 * HARD RULE: finding structured Product Details rows must NEVER end the search.
 * About this item is located independently and combined with the rows.
 *
 * Every finder below prefers a KNOWN, DEDICATED container (a stable id or
 * data-feature-name) over a generic heading-text search that climbs the DOM
 * looking for "something list-like nearby" — a wide climb can land on an
 * ancestor that also holds unrelated page content (nav, related items,
 * other widgets sharing that ancestor purely by coincidence of layout). The
 * loose, climbing signal is kept only as a last resort for pages where no
 * dedicated container exists at all, and never allowed to outrank a
 * dedicated container just because it happened to sweep up more elements.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { txt, isVisible, log } = AEB;

  const BAD_TEXT =
    /(product information|additional information|shipping|seller|customer review|customer question|sponsored|ask alexa|warranty & support|feedback|compare with similar)/i;

  /**
   * Containers Amazon really uses for description / product facts / feature
   * bullets — one entry per approved source (standalone description,
   * feature-bullets/"About this item", product-facts/"Top Highlights", and
   * product-overview/"Product Details"). This list exists ONLY to decide
   * whether a HIDDEN element is still trustworthy content (see
   * isUsableAmazonContent below); it must never include a container outside
   * the three approved boundaries — A+ ("#aplus") and the variation-picker
   * widget ("#twister-plus-inline-twister") used to be in here and let
   * unrelated marketing/variant text be trusted as if it were real
   * Description content whenever a heading-text search happened to climb
   * into one of them.
   */
  const APPROVED_CONTAINERS = [
    "#feature-bullets",
    "#featurebullets_feature_div",
    "[data-feature-name='featurebullets']",
    "#productFactsDesktopExpander",
    "#productFactsDesktop_feature_div",
    "#productOverview_feature_div",
    "#productDescription",
    "[data-feature-name='productDescription']",
  ];

  const ATTRIBUTE_BLOCKS = [
    "#productOverview_feature_div",
    "#productFactsDesktopExpander",
    "#productFactsDesktop_feature_div",
  ];

  const ABOUT_RX = /^about this item$/i;

  function cleanLabel(s) {
    return String(s || "")
      .replace(/[\s:‎]+$/g, "")
      .replace(/^[\s‎]+/g, "")
      .trim();
  }

  function isExcluded(label) {
    const desc = (window.AEB && window.AEB.description) || null;
    if (desc && desc.isExcludedLabel) return desc.isExcludedLabel(label);
    return /^(brand|brand name|manufacturer|manufacturer name|asin)$/i.test(
      String(label || "").replace(/[:\s]+/g, " ").trim(),
    );
  }

  function inApprovedContainer(el) {
    return APPROVED_CONTAINERS.some((sel) => el && el.closest && el.closest(sel));
  }

  /**
   * Collapsed-but-loaded Amazon description content is valid.
   * Unrelated hidden templates / duplicates are not.
   */
  function isUsableAmazonContent(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest("template, script, noscript, [data-aeb-template]")) return false;
    if (!txt(el)) return false;
    if (isVisible(el)) return true;
    // Hidden: only trust it inside a verified Amazon description container.
    return inApprovedContainer(el);
  }

  /* ------------------------------------------------------------------ *
   * Structured Product Details rows (never bullets)
   * ------------------------------------------------------------------ */
  function pushRow(out, seen, label, value) {
    const l = cleanLabel(label);
    const v = cleanLabel(value);
    if (!l || !v || l === v) return;
    if (l.length > 40 || v.length > 200) return;
    if (isExcluded(l)) return;
    const k = l.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label: l, value: v });
  }

  /** Requires explicit two-cell / label-value component evidence. `.a-list-item` is NOT accepted. */
  function collectAttributeRows(container) {
    if (!container) return [];
    const out = [];
    const seen = new Set();

    container.querySelectorAll("tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td,th");
      if (cells.length !== 2) return;
      pushRow(out, seen, txt(cells[0]), txt(cells[1]));
    });

    container
      .querySelectorAll(
        ".po-break-word, [class*='product-facts-detail'], .a-fixed-left-grid-inner, dl > div",
      )
      .forEach((row) => {
        if (row.closest("#feature-bullets, #featurebullets_feature_div, [data-feature-name='featurebullets']"))
          return;
        const kids = Array.from(row.children).filter((c) => txt(c));
        if (kids.length !== 2) return;
        pushRow(out, seen, txt(kids[0]), txt(kids[1]));
      });

    container.querySelectorAll("dt").forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") pushRow(out, seen, txt(dt), txt(dd));
    });

    return out;
  }

  /* ------------------------------------------------------------------ *
   * About this item
   * ------------------------------------------------------------------ */
  function bulletsFrom(container) {
    if (!container) return [];
    const nodes = Array.from(container.querySelectorAll("li, [role='listitem'], .a-list-item"));
    const kept = [];
    nodes.forEach((n) => {
      if (nodes.some((other) => other !== n && other.contains(n))) return; // avoid nested duplicates
      kept.push(n);
    });
    const out = [];
    const seen = new Set();
    kept.forEach((n) => {
      const t = txt(n);
      if (!t || t.length < 3) return;
      if (ABOUT_RX.test(t) || BAD_TEXT.test(t)) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push(t);
    });
    return out;
  }

  /** Text belonging directly to the element, excluding nested lists. */
  function ownText(el) {
    if (!el) return "";
    return Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isAboutHeading(el) {
    const t = txt(el);
    if (ABOUT_RX.test(t) && t.length < 30) return true;
    return ABOUT_RX.test(ownText(el));
  }

  function aboutHeadingIn(root) {
    const heads = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,span,div,p,strong"));
    return heads.find((h) => isAboutHeading(h)) || null;
  }

  function climbToBulletContainer(node) {
    let cur = node;
    for (let i = 0; i < 6 && cur; i += 1) {
      cur = cur.parentElement;
      if (cur && cur.querySelector("li, [role='listitem'], .a-list-item")) return cur;
    }
    return null;
  }

  /**
   * Multi-signal About this item detection.
   * @returns {{headingNode:Element|null,bulletContainer:Element|null,bullets:string[],reason:string|null,visible:boolean,domLoaded:boolean}}
   */
  function findAboutThisItemContent() {
    const candidates = [];

    // Tier 1 — known feature-bullet containers. Amazon's stable, dedicated
    // IDs for this exact section: the most reliable signal available.
    ["#feature-bullets", "#featurebullets_feature_div", "[data-feature-name='featurebullets']"].forEach((sel) => {
      document.querySelectorAll(sel).forEach((c) => {
        candidates.push({ tier: 1, headingNode: aboutHeadingIn(c), bulletContainer: c });
      });
    });

    // Tier 2 — Product Facts / Top Highlights components holding the
    // bullets: still a known, dedicated structural component, just the
    // newer page layout.
    ["#productFactsDesktopExpander", "#productFactsDesktop_feature_div"].forEach((sel) => {
      document.querySelectorAll(sel).forEach((c) => {
        const h = aboutHeadingIn(c);
        if (h) candidates.push({ tier: 2, headingNode: h, bulletContainer: climbToBulletContainer(h) || c });
      });
    });

    // Tier 3 — LAST RESORT: exact heading text anywhere on the page, climbing
    // to whatever ancestor first contains a bullet list. Deliberately the
    // least trusted signal: climbing from an arbitrary heading can land on
    // an ancestor that also contains an unrelated list elsewhere in the same
    // section (nav, related items, "customers also bought", ...). Only used
    // when neither dedicated container above found anything usable.
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,span,div,p,strong"))
      .filter((h) => isAboutHeading(h))
      .forEach((h) => {
        const container = h.querySelector("li, [role='listitem'], .a-list-item")
          ? h
          : climbToBulletContainer(h);
        if (container) candidates.push({ tier: 3, headingNode: h, bulletContainer: container });
      });

    const headingFound = candidates.some((c) => c.headingNode);
    const usable = candidates.filter(
      (c) => c.bulletContainer && isUsableAmazonContent(c.bulletContainer),
    );
    if (!usable.length) {
      return {
        headingNode: null,
        bulletContainer: null,
        bullets: [],
        visible: false,
        domLoaded: candidates.length > 0,
        reason: headingFound ? "ABOUT_CONTAINER_NOT_FOUND" : "ABOUT_HEADING_NOT_FOUND",
      };
    }

    // Reliability tier decides which candidates are even considered first —
    // NOT raw bullet count. Sorting the whole pool by bullet count alone let
    // a loose Tier-3 ancestor sweep (more bullets, but some of them
    // unrelated) win over the correct, narrowly-scoped Tier-1 match just
    // because it happened to contain more <li> elements. Only fall through
    // to a looser tier when every candidate in every better tier came back
    // with zero usable bullets.
    const withBullets = usable.map((c) => ({ ...c, bullets: bulletsFrom(c.bulletContainer) }));
    const byVisibilityThenCount = (a, b) => {
      const vis = Number(isVisible(b.bulletContainer)) - Number(isVisible(a.bulletContainer));
      return vis || b.bullets.length - a.bullets.length;
    };
    let best = null;
    for (const tier of [1, 2, 3]) {
      const inTier = withBullets.filter((c) => c.tier === tier && c.bullets.length);
      if (inTier.length) {
        best = inTier.sort(byVisibilityThenCount)[0];
        break;
      }
    }
    if (!best) {
      // Nothing anywhere had bullets — still surface the most reliable
      // container found for diagnostics, so the caller can report why.
      best = withBullets.sort((a, b) => a.tier - b.tier || byVisibilityThenCount(a, b))[0];
    }
    return {
      headingNode: best.headingNode,
      bulletContainer: best.bulletContainer,
      bullets: best.bullets,
      visible: isVisible(best.bulletContainer),
      domLoaded: true,
      reason: best.bullets.length ? null : "ABOUT_SECTION_FOUND_BUT_BULLETS_EMPTY",
    };
  }

  /* ------------------------------------------------------------------ *
   * Candidates for the three methods
   * ------------------------------------------------------------------ */
  function findStandaloneBlock() {
    const el =
      document.getElementById("productDescription") ||
      document.querySelector("#bookDescription_feature_div") ||
      document.querySelector("[data-feature-name='productDescription']");
    if (!el || !isUsableAmazonContent(el)) return null;
    const raw = txt(el).replace(/^product description\s*/i, "");
    if (!raw || BAD_TEXT.test(raw.slice(0, 60))) return null;
    return { element: el, text: raw };
  }

  function findProductDetailsBlock() {
    for (const sel of ATTRIBUTE_BLOCKS) {
      const el = document.querySelector(sel);
      if (el && collectAttributeRows(el).length) return el;
    }
    return null;
  }

  function findTopHighlightsBlock() {
    const heads = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,span,div,strong"));
    const h = heads.find((x) => /^top highlights?$/i.test(txt(x)));
    // Top Highlights is a verified Amazon component: collapsed/offscreen must not reject it.
    if (!h || !h.isConnected || h.closest("template, script, noscript, [data-aeb-template]")) return null;
    let node = h;
    for (let i = 0; i < 6 && node; i += 1) {
      node = node.parentElement;
      // Top Highlights is a structured label/value component, so a climbed-to
      // ancestor is only accepted once it actually yields real attribute
      // rows. Accepting any ancestor that merely contains SOME <li> anywhere
      // inside it (nav links, a related-items carousel, anything else that
      // happens to share this ancestor within 6 levels) is how unrelated
      // page content used to leak into the Description as if it were part
      // of Top Highlights.
      if (node && collectAttributeRows(node).length) return node;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Staged pipeline
   * ------------------------------------------------------------------ */
  function extractDescriptionData() {
    const standalone = findStandaloneBlock();
    const detailsBlock = findProductDetailsBlock();
    const topHighlights = findTopHighlightsBlock();
    // Independent — never gated on attributes being found or missing.
    const about = findAboutThisItemContent();

    const thAttributes = topHighlights ? collectAttributeRows(topHighlights) : [];
    const detailAttributes = detailsBlock ? collectAttributeRows(detailsBlock) : [];
    const attributes = thAttributes.length ? thAttributes : detailAttributes;
    const bullets = about.bullets;

    let sourceType = null;
    if (thAttributes.length) sourceType = "topHighlights";
    else if (bullets.length || attributes.length) sourceType = "aboutThisItem";
    else if (standalone) sourceType = "standalone";

    const data = {
      sourceType,
      attributes,
      heading: bullets.length ? "About this item" : "",
      bullets,
      standaloneText:
        sourceType === "standalone" || (!attributes.length && !bullets.length && standalone)
          ? standalone.text
          : "",
      diagnostics: {
        standaloneCandidate: Boolean(standalone),
        productDetailsCandidate: Boolean(detailsBlock),
        topHighlightsCandidate: Boolean(topHighlights),
        aboutHeadingFound: Boolean(about.headingNode) || about.reason !== "ABOUT_HEADING_NOT_FOUND",
        aboutContainerFound: Boolean(about.bulletContainer),
        aboutContentVisible: about.visible,
        aboutContentDomLoaded: about.domLoaded,
        attributesCaptured: attributes.length,
        bulletsCaptured: bullets.length,
        incompleteReason: bullets.length ? null : about.reason,
        selectedSource: sourceType,
      },
    };
    if (sourceType === "standalone" && !data.standaloneText && standalone) {
      data.standaloneText = standalone.text;
    }

    log("Amazon Description", data.diagnostics);
    return data;
  }

  AEB.amazonDescription = {
    extractDescriptionData,
    collectAttributeRows,
    bulletsFrom,
    findAboutThisItemContent,
    isAboutHeading,
    isUsableAmazonContent,
  };
})();

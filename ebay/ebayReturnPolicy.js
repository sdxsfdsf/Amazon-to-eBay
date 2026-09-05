/* global window, CSS */
/*
 * Selects the correct eBay Return Policy (Preferences -> Your settings ->
 * Returns -> Return policy) by exact policy NAME, ignoring any trailing
 * "(1,259 listings)"-style dynamic count. Same strict philosophy as
 * ebay/ebayPricing.js: locate the confirmed section, locate the real
 * control inside it, write, re-acquire the section fresh, read the result
 * back, verify it persisted. Fails with a specific code — never a silent
 * no-op, never a guess — whenever any step can't be confidently completed.
 */
(function () {
  const AEB = (window.AEB = window.AEB || {});
  const { txt, sleep, log } = AEB;

  const writer = () => AEB.ebayRealFieldWriter;

  /** Amazon RETURNABLE/NON_RETURNABLE -> the exact eBay policy name. Nothing else has a mapping. */
  const POLICY_FOR_STATUS = {
    RETURNABLE: "30 Days Return",
    NON_RETURNABLE: "No Return",
  };

  /** Strips a trailing "(1,259 listings)"-style dynamic count before comparing policy names. */
  function stripListingCount(text) {
    return String(text || "")
      .replace(/\(\s*[\d,]+\s*listings?\s*\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function namesMatch(a, b) {
    const x = stripListingCount(a).toLowerCase();
    const y = stripListingCount(b).toLowerCase();
    return Boolean(x) && x === y;
  }

  /** { section } or { error: "RETURNS_SECTION_NOT_FOUND" }. */
  function findReturnsSection() {
    const section = AEB.ebaySections.findReturnsSection();
    if (!section) return { error: "RETURNS_SECTION_NOT_FOUND" };
    return { section };
  }

  /** A <select> inside `section` whose OPTIONS' names (count stripped) include the target policy. */
  function findPolicySelect(section, policyName) {
    const selects = Array.from(section.querySelectorAll("select"));
    return selects.find((sel) => Array.from(sel.options || []).some((o) => namesMatch(o.textContent, policyName))) || null;
  }

  function labelFor(section, input) {
    if (input.id) {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(input.id) : input.id;
      const byFor = section.querySelector(`label[for='${escaped}']`);
      if (byFor) return byFor;
    }
    return input.closest("label");
  }

  /** Radio inputs inside `section` whose resolved label text (count stripped) matches the target policy. */
  function findPolicyRadio(section, policyName) {
    const radios = Array.from(section.querySelectorAll("input[type='radio']"));
    return (
      radios.find((r) => {
        const label = labelFor(section, r);
        const text = label ? txt(label) : r.getAttribute("aria-label") || "";
        return namesMatch(text, policyName);
      }) || null
    );
  }

  /** Currently selected policy name in `section` (count stripped), or "" if none resolvable. */
  function readSelectedPolicy(section) {
    const select = Array.from(section.querySelectorAll("select")).find((s) => s.options && s.options.length);
    if (select && select.selectedIndex >= 0 && select.options[select.selectedIndex]) {
      return stripListingCount(select.options[select.selectedIndex].textContent);
    }
    // Filtered in JS rather than a ":checked" selector so this works
    // identically regardless of the host environment's selector engine.
    const checked = Array.from(section.querySelectorAll("input[type='radio']")).find((r) => r.checked);
    if (checked) {
      const label = labelFor(section, checked);
      if (label) return stripListingCount(txt(label));
    }
    return "";
  }

  async function selectRadio(radio) {
    try {
      radio.click();
    } catch {
      /* fall through to a direct property + event dispatch below */
    }
    if (!radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event("input", { bubbles: true }));
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /**
   * Selects `policyName` ("30 Days Return" / "No Return") inside the
   * confirmed Returns section, verifies eBay actually persisted it, and
   * fails with a specific code rather than guessing whenever the section
   * or the control can't be confidently found.
   */
  async function selectReturnPolicy(policyName) {
    const located = findReturnsSection();
    if (located.error) return { ok: false, code: located.error };
    const { section } = located;

    const select = findPolicySelect(section, policyName);
    const radio = !select ? findPolicyRadio(section, policyName) : null;
    if (!select && !radio) return { ok: false, code: "RETURN_POLICY_CONTROL_NOT_FOUND" };

    if (select) {
      const opt = Array.from(select.options).find((o) => namesMatch(o.textContent, policyName));
      const ok = await writer().setRealInputValue(select, opt.textContent);
      if (!ok) return { ok: false, code: "RETURN_POLICY_WRITE_REJECTED" };
    } else {
      await selectRadio(radio);
    }

    // Give eBay's own state a moment to settle, then re-acquire the section
    // fresh (never trust a stale reference) and read back what's ACTUALLY
    // selected now — the same discipline the Description/Pricing writers use.
    await sleep(400);
    const reacquired = findReturnsSection();
    if (reacquired.error) return { ok: false, code: "RETURN_POLICY_VERIFY_FAILED" };
    const actual = readSelectedPolicy(reacquired.section);
    if (!namesMatch(actual, policyName)) return { ok: false, code: "RETURN_POLICY_NOT_PERSISTED", actual };
    return { ok: true, actual };
  }

  /**
   * Full flow: Amazon return status -> eBay Return Policy, or a clear
   * refusal. Never touches eBay's Return Policy unless the Amazon status is
   * a confident RETURNABLE or NON_RETURNABLE — anything else (UNKNOWN, or a
   * value this mapping doesn't recognize) leaves eBay's setting untouched
   * and reports the exact requested message.
   */
  async function applyReturnPolicyFromAmazonStatus(returnStatus) {
    const policyName = POLICY_FOR_STATUS[returnStatus];
    if (!policyName) {
      return { ok: false, code: "AMAZON_RETURN_STATUS_UNKNOWN", message: "Return policy not found on Amazon" };
    }
    const res = await selectReturnPolicy(policyName);
    log("eBay Return Policy", {
      "Amazon status": returnStatus,
      "Target policy": policyName,
      "Section located": res.code !== "RETURNS_SECTION_NOT_FOUND",
      Verified: res.ok,
      Actual: res.actual,
      code: res.ok ? null : res.code,
    });
    if (res.ok) return res;
    const messages = {
      RETURNS_SECTION_NOT_FOUND: "Could not locate the Returns section on eBay. Nothing was changed.",
      RETURN_POLICY_CONTROL_NOT_FOUND: `Found the Returns section, but no control for "${policyName}" was found.`,
      RETURN_POLICY_WRITE_REJECTED: "eBay rejected the return policy selection.",
      RETURN_POLICY_VERIFY_FAILED: "Could not re-locate the Returns section to verify the change.",
      RETURN_POLICY_NOT_PERSISTED: "eBay did not keep the selected return policy.",
    };
    return { ...res, message: messages[res.code] || res.message };
  }

  AEB.ebayReturnPolicy = {
    stripListingCount,
    namesMatch,
    findReturnsSection,
    selectReturnPolicy,
    applyReturnPolicyFromAmazonStatus,
    POLICY_FOR_STATUS,
  };
})();

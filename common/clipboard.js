/* global window, navigator, ClipboardItem */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  // Development mode: log clipboard diagnostics
  const DEBUG_CLIPBOARD = true; // Set to false in production

  function logDiagnostic(label, data) {
    if (!DEBUG_CLIPBOARD) return;
    // eslint-disable-next-line no-console
    console.log(`[AEB Clipboard / ${label}]`, data);
  }

  async function copyRich(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem && html) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text || ""], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
        logDiagnostic("copyRich", {
          method: "navigator.clipboard.write",
          format: "rich (html + text)",
          success: true,
        });
        return true;
      }
      await navigator.clipboard.writeText(text || "");
      logDiagnostic("copyRich", {
        method: "navigator.clipboard.writeText",
        format: "plain text",
        success: true,
      });
      return true;
    } catch (error) {
      logDiagnostic("copyRich", {
        method: "navigator.clipboard",
        error: {
          name: error?.name,
          message: error?.message,
        },
        hasFocus: document.hasFocus?.(),
        userActivationIsActive: navigator.userActivation?.isActive,
        userActivationHasBeenActive: navigator.userActivation?.hasBeenActive,
        fallbackAttempt: "execCommand",
      });
      return copyFallback(text || "");
    }
  }

  function copyFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
      logDiagnostic("copyFallback", {
        method: "document.execCommand",
        command: "copy",
        success: ok,
        hasFocus: document.hasFocus?.(),
        userActivationIsActive: navigator.userActivation?.isActive,
        userActivationHasBeenActive: navigator.userActivation?.hasBeenActive,
      });
    } catch (error) {
      ok = false;
      logDiagnostic("copyFallback", {
        method: "document.execCommand",
        command: "copy",
        error: {
          name: error?.name,
          message: error?.message,
        },
        hasFocus: document.hasFocus?.(),
        userActivationIsActive: navigator.userActivation?.isActive,
        userActivationHasBeenActive: navigator.userActivation?.hasBeenActive,
        success: false,
      });
    }
    ta.remove();
    return ok;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      logDiagnostic("copyText", {
        method: "navigator.clipboard.writeText",
        success: true,
      });
      return true;
    } catch (error) {
      logDiagnostic("copyText", {
        method: "navigator.clipboard.writeText",
        error: {
          name: error?.name,
          message: error?.message,
        },
        hasFocus: document.hasFocus?.(),
        userActivationIsActive: navigator.userActivation?.isActive,
        userActivationHasBeenActive: navigator.userActivation?.hasBeenActive,
        fallbackAttempt: "execCommand",
      });
      return copyFallback(text);
    }
  }

  Object.assign(AEB, { copyRich, copyText });
})();

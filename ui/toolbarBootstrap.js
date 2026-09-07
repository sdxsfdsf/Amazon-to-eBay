/* global chrome, document */
(function () {
  const root = document.documentElement;

  function applyCollapsed(collapsed) {
    root.classList.toggle("aeb-toolbar-collapsed", Boolean(collapsed));
  }

  chrome.storage.local.get("settings").then(({ settings }) => {
    applyCollapsed(settings && settings.collapsed);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings && changes.settings.newValue) {
      applyCollapsed(changes.settings.newValue.collapsed);
    }
  });
})();

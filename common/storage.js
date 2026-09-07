/* global chrome, window */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  const DEFAULTS = {
    autoFill: {
      title: false,
      description: true,
      suggestedItemSpecifics: true,
      requiredItemDetails: true,
      sellingPrice: true,
      quantity: true,
    },
    pricing: {
      taxRate: 8,
      finalValueFee: 13.5,
      promotedRate: 7,
      targetProfit: 15,
    },
    // Optional per-price-range override of the 4 pricing fields above. When
    // disabled (or when a price falls outside any configured range), the
    // flat `pricing` settings above are used exactly as before.
    advancedPricing: {
      enabled: false,
      thresholds: [10, 50],
      ranges: [
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
      ],
    },
    selectedAction: "prompt",
    collapsed: false,
    // Remembers where the user last dragged the collapsed 48px ball to;
    // null means "never moved yet, use the default corner".
    collapsedPosition: null,
  };

  async function getSettings() {
    const { settings } = await chrome.storage.local.get("settings");
    const saved = settings || {};
    return {
      ...DEFAULTS,
      ...saved,
      autoFill: { ...DEFAULTS.autoFill, ...(saved.autoFill || {}) },
      pricing: { ...DEFAULTS.pricing, ...(saved.pricing || {}) },
      advancedPricing: { ...DEFAULTS.advancedPricing, ...(saved.advancedPricing || {}) },
    };
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const next = {
      ...current,
      ...patch,
      autoFill: { ...current.autoFill, ...(patch.autoFill || {}) },
      pricing: { ...current.pricing, ...(patch.pricing || {}) },
      advancedPricing: { ...current.advancedPricing, ...(patch.advancedPricing || {}) },
    };
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  /** Captured product (no image bytes — those live in the service worker's IndexedDB). */
  async function getCapture() {
    const { capture } = await chrome.storage.local.get("capture");
    return capture || null;
  }

  async function setCapture(capture) {
    await chrome.storage.local.set({ capture });
  }

  Object.assign(AEB, { DEFAULT_SETTINGS: DEFAULTS, getSettings, saveSettings, getCapture, setCapture });
})();

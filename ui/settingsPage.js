/* global window, chrome */
(async function () {
  const AEB = window.AEB;
  const host = document.getElementById("aeb-settings-page");

  async function refreshCalculated(panel) {
    const [settings, capture] = await Promise.all([AEB.getSettings(), AEB.getCapture()]);
    const amazonPrice = capture && Number(capture.price) > 0 ? Number(capture.price) : null;
    panel.querySelector("[data-amazon-price]").textContent = amazonPrice == null ? "—" : `$${amazonPrice.toFixed(2)}`;
    const pricing = amazonPrice == null ? settings.pricing : AEB.pricing.resolvePricingSettings(amazonPrice, settings);
    AEB.panel.updateOutputs(panel, amazonPrice, pricing);
  }

  const settings = await AEB.getSettings();
  const panel = AEB.panel.buildSettings(settings, () => refreshCalculated(panel));
  panel.hidden = false;
  host.appendChild(panel);
  await refreshCalculated(panel);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.capture || changes.settings) refreshCalculated(panel);
  });
})();

/* global window, chrome */
/* Shared sticky top panel used on both Amazon and eBay. */
(function () {
  const AEB = (window.AEB = window.AEB || {});

  const ACTIONS = [
    { id: "prompt", label: "Prompt" },
    { id: "title", label: "Copy Title" },
    { id: "description", label: "Copy Description" },
    { id: "titleDescription", label: "Copy Title & Description" },
  ];

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, v);
    });
    children.filter(Boolean).forEach((c) => node.appendChild(c));
    return node;
  }

  /**
   * Makes `ballEl` draggable by pointer, ONLY while it is the collapsed
   * state's element (callers only ever attach this to the ball). A plain
   * click (no meaningful pointer movement in between) still fires `onTap`;
   * a real drag calls `onDropped({x,y})` once, with the ball's final
   * viewport position, and suppresses the click that would otherwise follow.
   */
  function makeDraggable(ballEl, { onTap, onDropped }) {
    const THRESHOLD = 4; // px of movement before a press counts as a drag
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    const clamp = (v, max) => Math.min(Math.max(v, 0), Math.max(0, max));

    ballEl.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return; // left button / touch only
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = ballEl.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      try {
        ballEl.setPointerCapture(e.pointerId);
      } catch {
        /* not critical */
      }
    });

    ballEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      moved = true;
      const maxX = window.innerWidth - ballEl.offsetWidth;
      const maxY = window.innerHeight - ballEl.offsetHeight;
      const nx = clamp(originX + dx, maxX);
      const ny = clamp(originY + dy, maxY);
      ballEl.style.left = `${nx}px`;
      ballEl.style.top = `${ny}px`;
      ballEl.style.right = "auto";
      ballEl.style.bottom = "auto";
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        const rect = ballEl.getBoundingClientRect();
        onDropped({ x: rect.left, y: rect.top });
      }
    };
    ballEl.addEventListener("pointerup", endDrag);
    ballEl.addEventListener("pointercancel", endDrag);

    ballEl.addEventListener("click", (e) => {
      if (moved) {
        // This click is the tail end of a drag gesture, not a tap — swallow it.
        e.preventDefault();
        e.stopPropagation();
        moved = false;
        return;
      }
      onTap();
    });
  }

  /**
   * @param {object} opts
   * @param {"amazon"|"ebay"} opts.mode
   * @param {Array} opts.buttons extra action buttons: {label, onClick, primary}
   * @param {(actionId:string)=>void} opts.onAction dropdown execution
   */
  async function createPanel(opts) {
    const existing = document.getElementById("aeb-root");
    if (existing) existing.remove();
    const oldBall = document.getElementById("aeb-ball");
    if (oldBall) oldBall.remove();
    const oldRestore = document.getElementById("aeb-restore"); // pre-existing installs, if any
    if (oldRestore) oldRestore.remove();

    const settings = await AEB.getSettings();
    let selectedAction = settings.selectedAction || "prompt";

    const root = el("div", { id: "aeb-root", role: "region", "aria-label": "Amazon to eBay Product Assistant" });
    // Collapsed state: a small round floating button rather than the full bar.
    // Draggable ONLY in this state (see makeDraggable below); expanding always
    // returns to the exact `root` bar built below, unchanged.
    const ball = el("button", {
      id: "aeb-ball",
      class: "aeb-ball",
      type: "button",
      text: "A→E",
      title: "Show Amazon → eBay Product Assistant",
      "aria-label": "Show Amazon → eBay Product Assistant",
      hidden: true,
    });

    const meta = el("div", { class: "aeb-meta" });
    const status = el("div", { class: "aeb-status", hidden: true, role: "status" });

    // ---- ONE regular dropdown button: [ Prompt ▾ ] opens a menu of real actions ----
    const toggleLabel = el("span", { class: "aeb-dropdown-label aeb-bold" });
    const chevronIcon = el("span", {
      class: "aeb-chevron-icon",
      text: "▾",
      role: "button",
      tabindex: "-1",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-label": "Show actions",
    });
    const toggle = el(
      "button",
      {
        class: "aeb-dropdown-toggle",
        type: "button",
      },
      [toggleLabel, chevronIcon],
    );
    const menu = el("div", { class: "aeb-menu", hidden: true, role: "menu" });
    const menuItems = [];
    const renderAction = () => {
      toggleLabel.textContent = ACTIONS.find((a) => a.id === selectedAction).label;
      menuItems.forEach((item) => {
        const on = item.dataset.actionId === selectedAction;
        item.setAttribute("aria-checked", on ? "true" : "false");
        item.firstChild.textContent = on ? "✓" : "";
      });
    };
    const closeMenu = () => {
      menu.hidden = true;
      chevronIcon.setAttribute("aria-expanded", "false");
      dropdown.classList.remove("aeb-open");
    };
    const openMenu = () => {
      menu.hidden = false;
      chevronIcon.setAttribute("aria-expanded", "true");
      dropdown.classList.add("aeb-open");
      const current = menuItems.find((i) => i.dataset.actionId === selectedAction) || menuItems[0];
      if (current) current.focus();
    };
    const focusItem = (dir) => {
      const idx = menuItems.indexOf(document.activeElement);
      const next = menuItems[(idx + dir + menuItems.length) % menuItems.length] || menuItems[0];
      if (next) next.focus();
    };
    ACTIONS.forEach((a) => {
      const item = el(
        "button",
        {
          type: "button",
          role: "menuitemradio",
          "data-action-id": a.id,
          onclick: async (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectedAction = a.id;
            renderAction();
            closeMenu();
            toggle.focus();
            await AEB.saveSettings({ selectedAction });
          },
        },
        [el("span", { class: "aeb-check-mark", text: "" }), el("span", { text: a.label })],
      );
      menuItems.push(item);
      menu.appendChild(item);
    });
    // Chevron zone = menu only. It must never run the selected action.
    chevronIcon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });
    // Main/label zone = run the currently selected action immediately.
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === chevronIcon || chevronIcon.contains(e.target)) return;
      closeMenu();
      opts.onAction(selectedAction);
    });
    menu.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusItem(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusItem(-1);
      } else if (e.key === "Escape") {
        closeMenu();
        toggle.focus();
      }
    });
    toggle.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      } else if (e.key === "Escape") closeMenu();
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !dropdown.contains(e.target)) closeMenu();
    });
    const dropdown = el("div", { class: "aeb-dropdown" }, [toggle, menu]);
    const split = dropdown;
    renderAction();


    // All of these touch shared resources (the eBay photo uploader, the
    // Description editor, ...), so only one may run at a time: clicking one
    // while another is still in flight is what let a slow upload and a
    // follow-up "Auto Fill All" click both submit the same batch of photos,
    // duplicating them on eBay's side. Running action disables the whole
    // group; it re-enables once that action's promise settles either way.
    let actionRunning = false;
    const extraButtons = (opts.buttons || []).map((b) =>
      el("button", {
        type: "button",
        text: b.label,
        class: [b.primary ? "aeb-primary" : "", b.bold || b.primary ? "aeb-bold" : ""].filter(Boolean).join(" "),
        onclick: async () => {
          if (actionRunning) return;
          actionRunning = true;
          setActionButtonsDisabled(true);
          try {
            await b.onClick();
          } finally {
            actionRunning = false;
            setActionButtonsDisabled(false);
          }
        },
      }),
    );
    function setActionButtonsDisabled(disabled) {
      extraButtons.forEach((btn) => {
        btn.disabled = disabled;
      });
      toggle.disabled = disabled;
    }

    const settingsBtn = el("button", { type: "button", class: "aeb-icon aeb-settings-button", text: "Settings", title: "Settings" });
    const collapseBtn = el("button", { type: "button", class: "aeb-icon", text: "▲", title: "Collapse" });

    const actionGroup = el("div", { class: "aeb-actions" }, [
      ...(opts.mode === "ebay" ? [split] : []),
      ...extraButtons,
    ]);

    const bar = el("div", { class: `aeb-bar aeb-bar-${opts.mode}` }, [
      el("span", { class: "aeb-brand", text: "AMAZON → EBAY" }),
      meta,
      el("span", { class: opts.mode === "ebay" ? "aeb-spacer" : "aeb-spacer aeb-spacer-wide" }),
      actionGroup,
      el("span", { class: "aeb-spacer" }),
      settingsBtn,
      collapseBtn,
    ]);


    const settingsPanel = buildSettings(settings, () => refreshMeta());
    root.append(bar, settingsPanel, status);
    document.documentElement.appendChild(root);
    document.documentElement.appendChild(ball);

    // The 44px slot is reserved at document_start by toolbarBootstrap.css.
    // Runtime measurement is intentionally forbidden: changing page padding
    // after first paint was the source of the Amazon/eBay layout jump.
    const applyOffset = () => {
      document.documentElement.classList.toggle("aeb-toolbar-collapsed", Boolean(root.hidden));
    };
    if (settings.collapsed) {
      root.hidden = true;
      ball.hidden = false;
    }
    applyOffset();

    settingsBtn.addEventListener("click", async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: "OPEN_SETTINGS_TAB" });
        if (response && response.ok) return;
      } catch {
        /* reported below */
      }
      setStatus("Could not open Settings.", "err");
    });

    /** Places the ball at its last dragged spot, or the default bottom-right corner. */
    function positionBall(savedPosition) {
      if (savedPosition && typeof savedPosition.x === "number" && typeof savedPosition.y === "number") {
        const maxX = Math.max(0, window.innerWidth - 48);
        const maxY = Math.max(0, window.innerHeight - 48);
        ball.style.left = `${Math.min(Math.max(savedPosition.x, 0), maxX)}px`;
        ball.style.top = `${Math.min(Math.max(savedPosition.y, 0), maxY)}px`;
        ball.style.right = "auto";
        ball.style.bottom = "auto";
      } else {
        ball.style.left = "";
        ball.style.top = "";
        ball.style.right = "20px";
        ball.style.bottom = "20px";
      }
    }

    const setCollapsed = async (collapsed, persist = true) => {
      root.hidden = collapsed;
      ball.hidden = !collapsed;
      if (collapsed) {
        const s = await AEB.getSettings();
        positionBall(s.collapsedPosition);
      }
      if (persist) await AEB.saveSettings({ collapsed });
      applyOffset();
    };
    collapseBtn.addEventListener("click", () => setCollapsed(true));
    // The ball is draggable only in this collapsed state; a plain tap expands
    // it back to exactly the bar built above. Dragging it just remembers
    // where it was dropped, for next time it collapses.
    makeDraggable(ball, {
      onTap: () => setCollapsed(false),
      onDropped: (pos) => AEB.saveSettings({ collapsedPosition: pos }),
    });
    if (settings.collapsed) setCollapsed(true, false);

    // ---- status: shows for 5s then leaves no vertical space ----
    const STATUS_KIND_CLASSES = ["aeb-status-ok", "aeb-status-err", "aeb-status-neutral"];
    function applyStatusKind(kind) {
      status.classList.remove(...STATUS_KIND_CLASSES);
      status.classList.add(kind === "ok" ? "aeb-status-ok" : kind === "err" ? "aeb-status-err" : "aeb-status-neutral");
    }
    let statusTimer = null;
    /** `kind`: "ok" (green), "err" (red), or anything else / omitted (black). */
    function setStatus(text, kind) {
      clearTimeout(statusTimer);
      status.textContent = text;
      applyStatusKind(kind);
      status.hidden = false;
      applyOffset();
      statusTimer = setTimeout(() => {
        status.hidden = true;
        status.textContent = "";
        applyOffset();
      }, 5000);
    }
    function setTempStatus(text, ms, kind) {
      clearTimeout(statusTimer);
      status.textContent = text;
      applyStatusKind(kind);
      status.hidden = false;
      applyOffset();
      statusTimer = setTimeout(() => {
        status.hidden = true;
        applyOffset();
      }, ms);
    }

    const api = {
      root,
      setStatus,
      setTempStatus,
      applyOffset,
      setMetaMessage: (text) => {
        meta.textContent = text;
      },
      getSelectedAction: () => selectedAction,
    };

    async function refreshMeta() {
      const capture = await AEB.getCapture();
      const s = await AEB.getSettings();
      if (!capture) {
        meta.textContent = "No Amazon variant captured yet.";
        settingsPanel.querySelector("[data-amazon-price]").textContent = "—";
        updateOutputs(settingsPanel, null, s.pricing);
        return;
      }
      const calc = AEB.pricing.calculate(capture.price || 0, AEB.pricing.resolvePricingSettings(capture.price || 0, s));
      meta.innerHTML = "";
      meta.append(
        el("span", { text: `ASIN: ` }, [el("b", { text: capture.asin || "—" })]),
        el("span", { text: `Amazon: ` }, [el("b", { text: capture.price ? `$${capture.price.toFixed(2)}` : "—" })]),
        el("span", { text: `Sell: ` }, [el("b", { text: `$${calc.finalSellingPrice.toFixed(2)}` })]),
        el("span", { text: `Qty: ` }, [el("b", { text: String(calc.quantity) })]),
        el("span", { text: `Images: ` }, [el("b", { text: String((capture.images || []).length) })]),
      );
      settingsPanel.querySelector("[data-amazon-price]").textContent = capture.price
        ? `$${capture.price.toFixed(2)}`
        : "—";
      // The "Calculated" card reflects what will actually happen for THIS
      // captured price, so it must resolve Advanced Pricing the same way the
      // real eBay fill does — unlike the live-typing preview inside the flat
      // Pricing Settings fields below, which intentionally always previews
      // just the flat fields being edited.
      updateOutputs(settingsPanel, capture.price, AEB.pricing.resolvePricingSettings(capture.price || 0, s));
      applyOffset();
    }

    api.refreshMeta = refreshMeta;
    await refreshMeta();
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.capture || changes.settings) refreshMeta();
    });
    return api;
  }

  function updateOutputs(panel, amazonPrice, pricing) {
    const out = panel.querySelector("[data-outputs]");
    if (!out) return;
    if (amazonPrice == null) {
      out.querySelectorAll("b").forEach((b) => {
        b.textContent = "—";
      });
      return;
    }
    const c = AEB.pricing.calculate(amazonPrice, pricing);
    out.querySelector("[data-sell]").textContent = `$${c.finalSellingPrice.toFixed(2)}`;
    out.querySelector("[data-profit]").textContent = `$${c.actualProfit.toFixed(2)}`;
    out.querySelector("[data-profit-pct]").textContent = `${c.actualProfitPct.toFixed(2)}%`;
    out.querySelector("[data-qty]").textContent = String(c.quantity);
  }

  function buildSettings(settings, onChanged) {
    const wrap = el("div", { class: "aeb-settings", hidden: true });

    function showSaved(target, message) {
      target.textContent = message;
      target.hidden = false;
    }

    const autoFillFields = [
      ["title", "Title"],
      ["description", "Description"],
      ["suggestedItemSpecifics", "Suggested Item Specifics"],
      ["requiredItemDetails", "Required Item Details"],
      ["sellingPrice", "Selling Price"],
      ["quantity", "Quantity"],
    ];
    const autoCard = el("div", { class: "aeb-card" }, [el("h4", { text: "Auto Fill Settings" })]);
    autoFillFields.forEach(([key, label]) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = Boolean(settings.autoFill[key]);
      cb.addEventListener("change", async () => {
        await AEB.saveSettings({ autoFill: { [key]: cb.checked } });
      });
      autoCard.appendChild(el("label", { class: "aeb-check" }, [cb, el("span", { text: label })]));
    });

    const priceFields = [
      ["taxRate", "Amazon Tax Rate (%)"],
      ["finalValueFee", "eBay Final Value Fee (%)"],
      ["promotedRate", "Promoted Listing Rate (%)"],
      ["targetProfit", "Target Profit (%)"],
    ];
    const priceCard = el("div", { class: "aeb-card" }, [el("h4", { text: "Pricing Settings" })]);
    const grid = el("div", { class: "aeb-grid" });
    grid.append(
      el("span", { text: "Amazon Price" }),
      el("b", { "data-amazon-price": "", text: "—" }),
    );
    const inputs = {};
    priceFields.forEach(([key, label]) => {
      const input = el("input", { type: "number", step: "0.1", value: String(settings.pricing[key]) });
      inputs[key] = input;
      input.addEventListener("input", async () => {
        const capture = await AEB.getCapture();
        const pricing = Object.fromEntries(
          Object.entries(inputs).map(([k, i]) => [k, Number(i.value) || 0]),
        );
        updateOutputs(wrap, capture ? capture.price : null, pricing);
      });
      grid.append(el("span", { text: label }), input);
    });
    const priceSaved = el("span", {
      class: "aeb-save-confirmation",
      text: "",
      hidden: true,
      role: "status",
      "aria-live": "polite",
    });
    const saveBtn = el("button", {
      type: "button",
      text: "Save Settings",
      onclick: async () => {
        const pricing = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, Number(i.value) || 0]));
        await AEB.saveSettings({ pricing });
        onChanged();
        showSaved(priceSaved, "Settings updated successfully.");
      },
    });
    priceCard.append(grid, el("div", { class: "aeb-save-row" }, [saveBtn, priceSaved]));

    // ---- Advanced Pricing: optional, per-Amazon-price-range overrides of ----
    // ---- the 4 fields above. Disabled/blank -> the flat card above wins. ----
    const adv = settings.advancedPricing || { enabled: false, thresholds: [10, 50], ranges: [] };
    const advCard = el("div", { class: "aeb-card" }, [el("h4", { text: "Advanced Pricing" })]);
    const advEnabled = el("input", { type: "checkbox" });
    advEnabled.checked = Boolean(adv.enabled);
    advCard.append(
      el("label", { class: "aeb-check" }, [
        advEnabled,
        el("span", { text: "Enable Advanced Pricing (overrides Pricing Settings by Amazon price)" }),
      ]),
      el("p", {
        class: "aeb-hint",
        text: "Two thresholds split the locked Amazon Price into up to three ranges, each with its own 4 settings below.",
      }),
    );

    const savedThresholds = Array.isArray(adv.thresholds) ? adv.thresholds : [10, 50];
    const thresholdInputs = [0, 1].map((i) =>
      el("input", { type: "number", step: "0.01", min: "0", value: String(savedThresholds[i] ?? "") }),
    );
    const thresholdGrid = el("div", { class: "aeb-grid" });
    thresholdGrid.append(
      el("span", { text: "Threshold 1 ($)" }),
      thresholdInputs[0],
      el("span", { text: "Threshold 2 ($)" }),
      thresholdInputs[1],
    );
    advCard.append(thresholdGrid);

    const rangeMeta = [
      ["Range 1 — below Threshold 1", 0],
      ["Range 2 — Threshold 1 up to Threshold 2", 1],
      ["Range 3 — Threshold 2 and above", 2],
    ];
    const savedRanges = Array.isArray(adv.ranges) && adv.ranges.length === 3 ? adv.ranges : [null, null, null];
    const rangeInputSets = rangeMeta.map(([label, i]) => {
      const sub = el("div", { class: "aeb-subcard" }, [el("h5", { text: label })]);
      const subGrid = el("div", { class: "aeb-grid" });
      const rInputs = {};
      priceFields.forEach(([key, flabel]) => {
        const startValue = (savedRanges[i] && savedRanges[i][key] != null ? savedRanges[i][key] : settings.pricing[key]);
        const input = el("input", { type: "number", step: "0.1", value: String(startValue) });
        rInputs[key] = input;
        subGrid.append(el("span", { text: flabel }), input);
      });
      sub.append(subGrid);
      advCard.append(sub);
      return rInputs;
    });

    const advancedSaved = el("span", {
      class: "aeb-save-confirmation",
      text: "",
      hidden: true,
      role: "status",
      "aria-live": "polite",
    });
    const advSaveBtn = el("button", {
      type: "button",
      text: "Save Advanced Pricing",
      onclick: async () => {
        const thresholds = thresholdInputs
          .map((i) => Number(i.value))
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b);
        const ranges = rangeInputSets.map((rInputs) =>
          Object.fromEntries(Object.entries(rInputs).map(([k, i]) => [k, Number(i.value) || 0])),
        );
        await AEB.saveSettings({ advancedPricing: { enabled: advEnabled.checked, thresholds, ranges } });
        onChanged();
        showSaved(advancedSaved, "Advanced pricing updated successfully.");
      },
    });
    advCard.append(el("div", { class: "aeb-save-row" }, [advSaveBtn, advancedSaved]));

    const outCard = el("div", { class: "aeb-card" }, [
      el("h4", { text: "Calculated" }),
      el("div", { "data-outputs": "" }, [
        el("div", { class: "aeb-out" }, [el("span", { text: "Selling Price" }), el("b", { "data-sell": "", text: "—" })]),
        el("div", { class: "aeb-out" }, [el("span", { text: "Expected Profit" }), el("b", { "data-profit": "", text: "—" })]),
        el("div", { class: "aeb-out" }, [el("span", { text: "Actual Profit %" }), el("b", { "data-profit-pct": "", text: "—" })]),
        el("div", { class: "aeb-out" }, [el("span", { text: "Quantity" }), el("b", { "data-qty": "", text: "—" })]),
      ]),
    ]);

    wrap.append(autoCard, priceCard, advCard, outCard);
    return wrap;
  }

  AEB.panel = { createPanel, buildSettings, updateOutputs, ACTIONS };
})();

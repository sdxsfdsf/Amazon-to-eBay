/* ui/panel.js interaction tests. Node-only; not loaded by the extension.
   run with:  node tests/panelInteractionTests.js

   Covers the two purely-UI requirements that have no prior test coverage in
   this codebase: the collapse-to-a-draggable-48px-ball behavior, the
   re-entrancy guard that stops overlapping Upload Image / Auto Fill All
   runs (the actual cause traced for the duplicated-image report), and the
   green/red/black status coloring. */
const fs = require("fs");
const path = require("path");
const shim = require("./panelDomShim.js");

let pass = 0,
  fail = 0;
const ck = (n, c, e) => (c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? " -- " + e : ""))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPanel(env) {
  const settingsStore = {
    collapsed: false,
    collapsedPosition: null,
    selectedAction: "prompt",
    autoFill: {
      title: false,
      description: true,
      suggestedItemSpecifics: true,
      requiredItemDetails: true,
      sellingPrice: true,
      quantity: true,
    },
    pricing: { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
    advancedPricing: {
      enabled: false,
      thresholds: [10, 50],
      ranges: [
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
        { taxRate: 8, finalValueFee: 13.5, promotedRate: 7, targetProfit: 15 },
      ],
    },
  };
  const saveSettingsCalls = [];
  env.window.AEB = {
    getSettings: async () => ({ ...settingsStore }),
    saveSettings: async (patch) => {
      saveSettingsCalls.push(patch);
      Object.assign(settingsStore, patch);
      return { ...settingsStore };
    },
    getCapture: async () => null,
    pricing: {
      calculate: () => ({ finalSellingPrice: 0, actualProfit: 0, actualProfitPct: 0, quantity: 0 }),
      resolvePricingSettings: (amazonPrice, s) => s.pricing,
    },
  };
  const code = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
  new Function(code).call(env.window);
  return { AEB: env.window.AEB, settingsStore, saveSettingsCalls };
}

async function freshPanel(buttons) {
  const env = shim.install();
  const { AEB, settingsStore, saveSettingsCalls } = loadPanel(env);
  const panel = await AEB.panel.createPanel({ mode: "ebay", buttons: buttons || [], onAction: () => {} });
  const root = env.byId["aeb-root"];
  const ball = env.byId["aeb-ball"];
  return { env, AEB, panel, root, ball, settingsStore, saveSettingsCalls };
}

(async () => {
  console.log("\n[P1] Initial mount: bar visible, ball hidden");
  {
    const { root, ball } = await freshPanel();
    ck("root exists", !!root);
    ck("ball exists", !!ball);
    ck("root starts expanded (not hidden)", root.hidden !== true);
    ck("ball starts hidden", ball.hidden === true);
  }

  console.log("\n[P2] Collapse button -> 48px ball shown, bar hidden, default corner position");
  {
    const { root, ball } = await freshPanel();
    const collapseBtn = root.querySelectorAll("button").find((b) => b.getAttribute("title") === "Collapse");
    ck("collapse button found", !!collapseBtn);
    collapseBtn.dispatch("click");
    await sleep(5);
    ck("root now hidden", root.hidden === true);
    ck("ball now shown", ball.hidden === false);
    ck("default position is the bottom-right corner", ball.style.right === "20px" && ball.style.bottom === "20px");
  }

  console.log("\n[P3] Plain tap on the ball expands back to the exact same bar (no drag)");
  {
    const { root, ball } = await freshPanel();
    ball.hidden = false;
    root.hidden = true;
    ball.dispatch("pointerdown", { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    ball.dispatch("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });
    ball.dispatch("click", {});
    await sleep(5);
    ck("root expanded again", root.hidden === false);
    ck("ball hidden again", ball.hidden === true);
  }

  console.log("\n[P4] Dragging the ball moves it and persists the dropped position (does not expand)");
  {
    const { root, ball, saveSettingsCalls } = await freshPanel();
    ball.hidden = false;
    root.hidden = true;
    ball._x = 20;
    ball._y = 700; // matches getBoundingClientRect() used at pointerdown time
    ball.dispatch("pointerdown", { clientX: 20, clientY: 700, pointerId: 1, button: 0 });
    ball.dispatch("pointermove", { clientX: 70, clientY: 660, pointerId: 1 }); // dx=50, dy=-40: well past the drag threshold
    ball.dispatch("pointerup", { clientX: 70, clientY: 660, pointerId: 1 });
    ball.dispatch("click", {}); // the tail-end click of the same gesture
    await sleep(5);
    ck("ball moved to the dragged spot", ball.style.left === "70px" && ball.style.top === "660px");
    ck("drag does NOT expand the bar", root.hidden === true);
    const posSave = saveSettingsCalls.find((p) => p.collapsedPosition);
    ck("dropped position was persisted", !!posSave, JSON.stringify(saveSettingsCalls));
    ck("persisted position matches", posSave && posSave.collapsedPosition.x === 70 && posSave.collapsedPosition.y === 660);
  }

  console.log("\n[P5] Dragging clamps to the viewport (can't be dropped off-screen)");
  {
    const { ball } = await freshPanel();
    ball.hidden = false;
    ball._x = 1250;
    ball._y = 10;
    ball.dispatch("pointerdown", { clientX: 1250, clientY: 10, pointerId: 1, button: 0 });
    // Drag far past the right edge of a 1280-wide viewport with a 48px ball.
    ball.dispatch("pointermove", { clientX: 5000, clientY: 10, pointerId: 1 });
    ball.dispatch("pointerup", { clientX: 5000, clientY: 10, pointerId: 1 });
    ck("clamped to innerWidth - ballWidth", ball.style.left === `${1280 - 48}px`, ball.style.left);
  }

  console.log("\n[P6] A saved position is restored (clamped) the next time it collapses");
  {
    const { root, ball, settingsStore } = await freshPanel();
    settingsStore.collapsedPosition = { x: 9999, y: 40 }; // stale / now off-screen
    root.hidden = false;
    const collapseBtn = root.querySelectorAll("button").find((b) => b.getAttribute("title") === "Collapse");
    collapseBtn.dispatch("click");
    await sleep(5);
    ck("restored position is clamped back on-screen", ball.style.left === `${1280 - 48}px`, ball.style.left);
  }

  console.log("\n[P7] Action buttons are mutually exclusive while one is running (the upload-dedup fix)");
  {
    let running = 0;
    let concurrentCalls = 0;
    let resolveFirst;
    const first = new Promise((r) => (resolveFirst = r));
    const onClickA = async () => {
      running += 1;
      if (running > 1) concurrentCalls += 1;
      await first;
      running -= 1;
    };
    let bCalls = 0;
    const onClickB = async () => {
      bCalls += 1;
    };
    const { root } = await freshPanel([
      { label: "Upload Image", onClick: onClickA },
      { label: "Auto Fill All", onClick: onClickB, primary: true },
    ]);
    const buttons = root.querySelectorAll("button");
    const uploadBtn = buttons.find((b) => b.textContent === "Upload Image");
    const autoBtn = buttons.find((b) => b.textContent === "Auto Fill All");

    uploadBtn.dispatch("click"); // starts onClickA, which is now awaiting `first`
    await sleep(5);
    ck("upload button disabled while its own action runs", uploadBtn.disabled === true);
    ck("the OTHER action button is also disabled meanwhile", autoBtn.disabled === true);

    autoBtn.dispatch("click"); // must be ignored — onClickA has not resolved yet
    uploadBtn.dispatch("click"); // a second, impatient click on the same button — also ignored
    await sleep(5);
    ck("clicking while busy never re-entered the running action", concurrentCalls === 0);
    ck("the other action never ran while the first was busy", bCalls === 0);

    resolveFirst();
    await sleep(10);
    ck("buttons re-enabled once the action settles", uploadBtn.disabled === false && autoBtn.disabled === false);

    autoBtn.dispatch("click");
    await sleep(5);
    ck("the other action runs fine once the first has finished", bCalls === 1);
  }

  console.log("\n[P8] Status coloring: ok/err/neutral map to distinct classes, default is neutral");
  {
    const { panel, root } = await freshPanel();
    const status = root.querySelectorAll("div").find((d) => String(d.className || "").includes("aeb-status"));
    ck("status element found", !!status);
    panel.setStatus("Description: verified", "ok");
    ck("ok -> aeb-status-ok", status.classList.contains("aeb-status-ok"));
    ck("ok -> not err/neutral", !status.classList.contains("aeb-status-err") && !status.classList.contains("aeb-status-neutral"));

    panel.setStatus("Images: IMAGE_UPLOADER_NOT_FOUND", "err");
    ck("err -> aeb-status-err", status.classList.contains("aeb-status-err"));
    ck("err -> not ok/neutral", !status.classList.contains("aeb-status-ok") && !status.classList.contains("aeb-status-neutral"));

    panel.setTempStatus("Uploading images…", 5000, "neutral");
    ck("neutral -> aeb-status-neutral", status.classList.contains("aeb-status-neutral"));

    panel.setStatus("Some message with no kind supplied");
    ck("omitted kind defaults to neutral (never silently green/red)", status.classList.contains("aeb-status-neutral"));
  }

  console.log("\n[P9] Advanced Pricing settings UI: renders, and saving produces the expected shape");
  {
    const { env, root, saveSettingsCalls } = await freshPanel();
    const settingsPanel = root.querySelectorAll("div").find((d) => String(d.className || "").includes("aeb-settings"));
    ck("settings panel found", !!settingsPanel);
    const returnPolicyLabel = root.querySelectorAll("span").find((s) => s.textContent === "Return Policy");
    ck("Return Policy auto-fill checkbox is completely absent", !returnPolicyLabel);
    const advHeading = root.querySelectorAll("h4").find((h) => h.textContent === "Advanced Pricing");
    ck("Advanced Pricing card heading present", !!advHeading);
    const checkboxes = root.querySelectorAll("input").filter((i) => i.getAttribute("type") === "checkbox");
    ck("checkbox count excludes the removed Return Policy control", checkboxes.length === 7, String(checkboxes.length));
    const numberInputs = root.querySelectorAll("input").filter((i) => i.getAttribute("type") === "number");
    // 4 flat Pricing fields + 2 thresholds + (4 fields x 3 ranges) = 18
    ck("all pricing number inputs present", numberInputs.length === 18, String(numberInputs.length));

    const saveAdvBtn = root.querySelectorAll("button").find((b) => b.textContent === "Save Advanced Pricing");
    ck("Save Advanced Pricing button present", !!saveAdvBtn);

    // Enable it and give distinct values to each range so we can tell them apart.
    checkboxes[checkboxes.length - 1].checked = true; // the advanced-pricing enable checkbox is appended last
    {
      const grids = root.querySelectorAll("div").filter((d) => String(d.className || "") === "aeb-grid");
      // thresholdGrid is the 2nd aeb-grid (1st is the flat Pricing Settings grid).
      const thresholdGrid = grids[1];
      const [t1, t2] = thresholdGrid.querySelectorAll("input");
      t1.value = "15";
      t2.value = "40";
    }
    saveAdvBtn.dispatch("click");
    await sleep(5);
    const saved = saveSettingsCalls.find((p) => p.advancedPricing);
    ck("save call included advancedPricing", !!saved, JSON.stringify(saveSettingsCalls));
    ck("enabled was saved as true", saved && saved.advancedPricing.enabled === true);
    ck("thresholds were saved and sorted", saved && JSON.stringify(saved.advancedPricing.thresholds) === JSON.stringify([15, 40]));
    ck("exactly 3 ranges were saved", saved && saved.advancedPricing.ranges.length === 3);
    ck(
      "each saved range has all 4 pricing fields",
      saved &&
        saved.advancedPricing.ranges.every(
          (r) => ["taxRate", "finalValueFee", "promotedRate", "targetProfit"].every((k) => typeof r[k] === "number"),
        ),
    );
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();

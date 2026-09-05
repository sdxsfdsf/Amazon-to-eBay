/* eBay photo-upload single-submission + verification tests. Node-only.
   run with: node tests/imageUploadDedupeTests.js */
const fs = require("fs");
const path = require("path");
const P = (...p) => path.join(__dirname, "..", ...p);

let pass = 0;
let fail = 0;
const ck = (name, condition, extra) => {
  if (condition) {
    pass += 1;
    console.log("  PASS  " + name);
  } else {
    fail += 1;
    console.log("  FAIL  " + name + (extra ? " -- " + extra : ""));
  }
};

function makeHarness({
  fileCount = 4,
  initialPhotos = 0,
  acceptOnChange = null,
  delayRestMs = 0,
  clampBulkPreDispatch = false,
  throwBulkPreDispatch = false,
  throwEveryAssignment = false,
  inputMultiple = true,
  verificationTimeoutMs = 80,
  counterOverride = null,
} = {}) {
  const names = ["main.jpg", "g2.jpg", "g3.jpg", "g4.jpg", "g5.jpg", "g6.jpg", "g7.jpg"].slice(0, fileCount);
  const sourceFiles = names.map((name, i) => ({ name, size: 1000 + i, type: "image/jpeg" }));
  const server = Array.from({ length: initialPhotos }, (_, i) => `existing-${i}.jpg`);
  const submissions = [];
  const eventCounts = { input: 0, change: 0, dragenter: 0, dragover: 0, drop: 0 };

  function accept(files) {
    files.forEach((f) => server.push(f.name));
  }

  const input = {
    accept: "image/*",
    multiple: inputMultiple,
    disabled: false,
    isConnected: true,
    id: "photo-input",
    name: "photos",
    className: "photo-uploader",
    getAttribute: () => null,
    closest: () => photoSection,
    parentElement: null,
    _files: [],
    dispatchEvent(ev) {
      eventCounts[ev.type] = (eventCounts[ev.type] || 0) + 1;
      if (ev.type === "change") {
        const batch = Array.from(this._files || []);
        submissions.push(batch.map((f) => f.name));
        const acceptedNow = acceptOnChange == null ? batch.length : Math.max(0, Math.min(batch.length, acceptOnChange));
        accept(batch.slice(0, acceptedNow));
        if (delayRestMs > 0 && acceptedNow < batch.length) {
          setTimeout(() => accept(batch.slice(acceptedNow)), delayRestMs);
        }
      }
      // If production accidentally reintroduces DragEvent submission, count it.
      if (ev.type === "drop" && ev.dataTransfer && ev.dataTransfer.files) {
        const batch = Array.from(ev.dataTransfer.files);
        submissions.push(batch.map((f) => f.name));
        accept(batch);
      }
      return true;
    },
  };

  Object.defineProperty(input, "files", {
    get() {
      return this._files;
    },
    set(value) {
      const arr = Array.from(value || []);
      if (throwEveryAssignment) throw new Error("all assignments rejected");
      if (arr.length > 1 && throwBulkPreDispatch) throw new Error("bulk assignment rejected");
      if (arr.length > 1 && clampBulkPreDispatch) {
        this._files = arr.slice(0, 1);
        return;
      }
      this._files = arr;
    },
    configurable: true,
  });

  const photoSection = {
    isConnected: true,
    get textContent() {
      const n = typeof counterOverride === "function" ? counterOverride(server.length) : counterOverride;
      return `${n == null ? server.length : n}/25`;
    },
    get innerText() {
      const n = typeof counterOverride === "function" ? counterOverride(server.length) : counterOverride;
      return `${n == null ? server.length : n}/25`;
    },
    querySelectorAll(selector) {
      if (selector === "input[type='file']") return [input];
      if (selector === "img") {
        return server.map((name, i) => ({
          isConnected: true,
          currentSrc: `https://i.ebayimg.com/${i}-${name}`,
          src: `https://i.ebayimg.com/${i}-${name}`,
          getBoundingClientRect: () => ({ width: 100, height: 100 }),
        }));
      }
      return [];
    },
  };
  input.parentElement = photoSection;

  global.DataTransfer = class {
    constructor() {
      const values = [];
      this.items = { add: (file) => values.push(file) };
      this._values = values;
    }
    get files() {
      return this._values;
    }
  };
  global.Event = class {
    constructor(type, opts = {}) {
      this.type = type;
      Object.assign(this, opts);
    }
  };
  global.document = {
    isConnected: true,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  global.window = {};
  window.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  window.AEB = {
    isVisible: () => true,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    log: () => {},
    __imageVerificationTimeoutMs: verificationTimeoutMs,
    ebaySections: { findPhotoSection: () => photoSection },
    imageStore: { getFiles: async () => sourceFiles },
  };

  new Function(fs.readFileSync(P("ebay", "ebayPhotoUploader.js"), "utf8")).call(window);

  return {
    upload: () => window.AEB.ebayPhotos.uploadImages("capture", []),
    server,
    submissions,
    eventCounts,
    input,
    sourceFiles,
  };
}

(async () => {
  console.log("\n[A] Happy path: one batch, one change event, no drag/drop");
  {
    const h = makeHarness({ fileCount: 4 });
    const res = await h.upload();
    console.log("      result:", JSON.stringify(res), "photos:", JSON.stringify(h.server));
    ck("reports 4/4 verified", res.ok && res.verified === 4 && res.submitted === 4, JSON.stringify(res));
    ck("exactly one submitted batch", h.submissions.length === 1, JSON.stringify(h.submissions));
    ck("all source images submitted once", h.submissions[0].length === 4 && new Set(h.submissions[0]).size === 4);
    ck("no drag/drop submission events", h.eventCounts.drop === 0 && h.eventCounts.dragenter === 0 && h.eventCounts.dragover === 0, JSON.stringify(h.eventCounts));
  }

  console.log("\n[B] Real regression shape: only 1 photo appears first, the rest render later");
  {
    const h = makeHarness({ fileCount: 7, acceptOnChange: 1, delayRestMs: 8, verificationTimeoutMs: 120 });
    const res = await h.upload();
    console.log("      result:", JSON.stringify(res), "count:", h.server.length, "submissions:", JSON.stringify(h.submissions));
    ck("waits until all 7 are verified", res.ok && res.verified === 7, JSON.stringify(res));
    ck("does NOT resubmit files 2-7", h.submissions.length === 1, JSON.stringify(h.submissions));
    ck("final eBay count is exactly 7, not 13", h.server.length === 7, String(h.server.length));
    ck("each filename appears once", new Set(h.server).size === h.server.length, JSON.stringify(h.server));
  }

  console.log("\n[C] Partial/uncertain acceptance: never infer missing file identities and never retry");
  {
    const h = makeHarness({ fileCount: 4, acceptOnChange: 2, verificationTimeoutMs: 20 });
    const res = await h.upload();
    console.log("      result:", JSON.stringify(res), "photos:", JSON.stringify(h.server), "submissions:", JSON.stringify(h.submissions));
    ck("reports verification incomplete instead of false success", !res.ok && res.code === "IMAGE_UPLOAD_VERIFICATION_INCOMPLETE", JSON.stringify(res));
    ck("only one batch was submitted", h.submissions.length === 1, JSON.stringify(h.submissions));
    ck("does not resend assumed remaining files", h.server.length === 2, JSON.stringify(h.server));
  }

  console.log("\n[D] Proven PRE-DISPATCH bulk clamp: safe one-by-one fallback");
  {
    const h = makeHarness({ fileCount: 4, clampBulkPreDispatch: true });
    const res = await h.upload();
    console.log("      result:", JSON.stringify(res), "submissions:", JSON.stringify(h.submissions));
    ck("reports success", res.ok === true, JSON.stringify(res));
    ck("uses one-by-one only because bulk was never dispatched", h.submissions.length === 4 && h.submissions.every((x) => x.length === 1), JSON.stringify(h.submissions));
    ck("every source file submitted exactly once", h.submissions.flat().length === new Set(h.submissions.flat()).size, JSON.stringify(h.submissions));
  }

  console.log("\n[E] Proven PRE-DISPATCH bulk throw: safe one-by-one fallback");
  {
    const h = makeHarness({ fileCount: 4, throwBulkPreDispatch: true });
    const res = await h.upload();
    ck("recovers safely", res.ok === true, JSON.stringify(res));
    ck("four one-file submissions, no duplicate batch", h.submissions.length === 4 && h.submissions.flat().length === 4, JSON.stringify(h.submissions));
  }

  console.log("\n[F] Every assignment fails before dispatch: actionable rejection, zero submissions");
  {
    const h = makeHarness({ fileCount: 2, throwEveryAssignment: true });
    const res = await h.upload();
    ck("returns FILE_ASSIGNMENT_REJECTED", !res.ok && res.code === "FILE_ASSIGNMENT_REJECTED", JSON.stringify(res));
    ck("nothing was dispatched to eBay", h.submissions.length === 0, JSON.stringify(h.submissions));
  }

  console.log("\n[G] Native single-file input: never attempts an unsafe bulk dispatch");
  {
    const h = makeHarness({ fileCount: 4, inputMultiple: false });
    const res = await h.upload();
    ck("uploads all files", res.ok && res.verified === 4, JSON.stringify(res));
    ck("each file submitted once", h.submissions.length === 4 && h.submissions.every((x) => x.length === 1), JSON.stringify(h.submissions));
  }

  console.log("\n[H] Existing gallery baseline uses eBay counter correctly");
  {
    const h = makeHarness({ fileCount: 4, initialPhotos: 3 });
    const res = await h.upload();
    ck("verifies 4 newly added photos, not total gallery size", res.ok && res.verified === 4, JSON.stringify(res));
    ck("final gallery is 7", h.server.length === 7, String(h.server.length));
  }

  console.log("\n[I] In-flight guard blocks overlapping second operation but allows a later click");
  {
    const h = makeHarness({ fileCount: 4, acceptOnChange: 1, delayRestMs: 10, verificationTimeoutMs: 120 });
    const p1 = h.upload();
    const p2 = h.upload();
    const [r1, r2] = await Promise.all([p1, p2]);
    ck("first operation completes", r1.ok === true, JSON.stringify(r1));
    ck("overlap is blocked", !r2.ok && r2.code === "IMAGE_UPLOAD_ALREADY_IN_PROGRESS", JSON.stringify(r2));
    ck("overlap did not submit a second batch", h.submissions.length === 1, JSON.stringify(h.submissions));
    // New manual operation after the first is finished is allowed.
    const r3 = await h.upload();
    ck("later manual click is allowed", r3.ok === true, JSON.stringify(r3));
    ck("later click creates exactly one additional batch", h.submissions.length === 2, JSON.stringify(h.submissions));
  }


  console.log("\n[J] Stale eBay counter must not override already-rendered photo cards");
  {
    const h = makeHarness({ fileCount: 7, counterOverride: 1, verificationTimeoutMs: 40 });
    const res = await h.upload();
    console.log("      result:", JSON.stringify(res), "count:", h.server.length, "submissions:", JSON.stringify(h.submissions));
    ck("rendered 7 photos verify even while visible counter is stale at 1/25", res.ok && res.verified === 7, JSON.stringify(res));
    ck("stale counter does not cause a second submission", h.submissions.length === 1, JSON.stringify(h.submissions));
    ck("final gallery remains exactly 7", h.server.length === 7, String(h.server.length));
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();

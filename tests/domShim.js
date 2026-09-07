/* A deliberately small DOM implementation — just enough surface for the
   selectors and properties AEB.ebayRealFieldWriter actually uses. */

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this._text = attrs.text || "";
    delete this.attrs.text;
    this.value = this.attrs.value != null ? String(this.attrs.value) : "";
    delete this.attrs.value;
    this.disabled = !!this.attrs.disabled;
    this.readOnly = !!this.attrs.readonly;
    this.checked = !!this.attrs.checked;
    delete this.attrs.checked;
    this.isConnected = true;
    this._hidden = !!this.attrs.__hidden;
    delete this.attrs.__hidden;
    children.forEach((c) => this.appendChild(c));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get id() {
    return this.attrs.id || "";
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
  }

  get className() {
    return this.attrs.class || "";
  }

  /** Direct-text pseudo-nodes only (nodeType 3), sufficient for ownText()'s filter. */
  get childNodes() {
    const nodes = [];
    if (this._text) nodes.push({ nodeType: 3, textContent: this._text });
    this.children.forEach((c) => nodes.push(c));
    return nodes;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join(" ");
  }

  getAttribute(name) {
    const v = this.attrs[name];
    return v === undefined ? null : String(v);
  }

  setAttribute(name, v) {
    this.attrs[name] = v;
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  get isContentEditable() {
    return this.attrs.contenteditable === "true" || this.attrs.contenteditable === "";
  }

  descendants() {
    const out = [];
    const walk = (n) => n.children.forEach((c) => (out.push(c), walk(c)));
    walk(this);
    return out;
  }

  contains(other) {
    if (other === this) return true;
    return this.descendants().includes(other);
  }

  closest(sel) {
    let n = this;
    while (n) {
      if (matches(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }

  matches(sel) {
    return matches(this, sel);
  }

  querySelectorAll(sel) {
    return this.descendants().filter((n) => matches(n, sel));
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  getBoundingClientRect() {
    if (this._hidden) return { width: 0, height: 0 };
    return { width: 200, height: this.tagName === "IFRAME" ? 300 : 30 };
  }

  cloneNode() {
    const c = new Node(this.tagName, { ...this.attrs, text: this._text }, []);
    this.children.forEach((ch) => c.appendChild(ch.cloneNode()));
    return c;
  }

  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }

  focus() {}
  blur() {}
  click() {}
  select() {}
  dispatchEvent() {
    return true;
  }
}

/** Supports: tag, #id, .class, [attr], [attr='v'], [attr*='v'], tag[attr='v'], comma groups. */
function matchesSimple(node, sel) {
  sel = sel.trim();
  if (!sel) return false;
  if (sel === "*") return true;

  const attrRe = /\[([a-zA-Z-]+)(?:([*^$]?=)'([^']*)')?\]/g;
  const attrParts = [];
  let m;
  while ((m = attrRe.exec(sel))) attrParts.push(m);
  const base = sel.replace(attrRe, "").trim();

  if (base) {
    if (base.startsWith("#")) {
      if (node.id !== base.slice(1)) return false;
    } else if (base.startsWith(".")) {
      const cls = base.slice(1);
      if (!String(node.className).split(/\s+/).includes(cls)) return false;
    } else if (node.tagName !== base.toUpperCase()) {
      return false;
    }
  }
  for (const [, name, op, val] of attrParts) {
    const actual = node.getAttribute(name);
    if (actual === null) return false;
    if (!op) continue;
    if (op === "=" && actual !== val) return false;
    if (op === "*=" && !actual.includes(val)) return false;
    if (op === "^=" && !actual.startsWith(val)) return false;
    if (op === "$=" && !actual.endsWith(val)) return false;
  }
  return true;
}

function matches(node, sel) {
  return sel
    .split(",")
    .map((s) => s.trim())
    .some((s) => matchesSimple(node, s));
}

function h(tag, attrs = {}, children = []) {
  return new Node(tag, attrs, children);
}

/** Installs a global document/window built from `root`. */
function install(root) {
  const doc = new Node("body", {}, [root]);
  doc.body = doc;
  doc.getElementById = (id) => doc.querySelectorAll("*").find((n) => n.id === id) || null;
  doc.createRange = () => ({ selectNodeContents() {} });
  doc.execCommand = () => true;

  global.document = doc;
  global.window = {
    document: doc,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    getComputedStyle: (n) => ({
      visibility: n._hidden ? "hidden" : "visible",
      display: n._hidden ? "none" : "block",
      opacity: "1",
    }),
  };
  global.getComputedStyle = global.window.getComputedStyle;
  global.CSS = { escape: (s) => s };
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.HTMLTextAreaElement = function () {};
  global.HTMLSelectElement = function () {};
  global.HTMLInputElement = function () {};
  global.Event = class {
    constructor(t) {
      this.type = t;
    }
  };
  global.InputEvent = global.Event;
  global.FocusEvent = global.Event;
  global.KeyboardEvent = global.Event;
  return doc;
}

module.exports = { h, install, Node };

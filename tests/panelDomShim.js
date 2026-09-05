/* A small, purpose-built DOM+browser mock covering exactly what ui/panel.js
   touches (see the `grep` list this was built from) — not a general-purpose
   shim. Good enough to mount createPanel() for real and drive its buttons
   and pointer handlers from a Node test. */

function makeElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    _attrs: {},
    _children: [],
    parentElement: null,
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
      removeProperty(name) {
        delete this[name];
      },
    },
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    innerHTML: "",
    offsetWidth: 48,
    offsetHeight: 48,
    className: "",
    get classList() {
      const self = this;
      const set = () => new Set(String(self.className || "").split(/\s+/).filter(Boolean));
      return {
        add: (...cls) => {
          const s = set();
          cls.forEach((c) => s.add(c));
          self.className = Array.from(s).join(" ");
        },
        remove: (...cls) => {
          const s = set();
          cls.forEach((c) => s.delete(c));
          self.className = Array.from(s).join(" ");
        },
        contains: (c) => set().has(c),
        toggle: (c, force) => {
          const s = set();
          const has = s.has(c);
          const want = force == null ? !has : force;
          if (want) s.add(c);
          else s.delete(c);
          self.className = Array.from(s).join(" ");
          return want;
        },
      };
    },
    setAttribute(name, value) {
      this._attrs[name] = String(value);
      if (name === "hidden") this.hidden = true;
      if (name === "disabled") this.disabled = true;
      if (name.startsWith("data-")) {
        const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = String(value);
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    removeAttribute(name) {
      delete this._attrs[name];
    },
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((h) => h !== handler);
    },
    dispatch(type, evt = {}) {
      const event = Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, evt);
      (listeners[type] || []).slice().forEach((h) => h.call(this, event));
    },
    appendChild(child) {
      child.parentElement = this;
      this._children.push(child);
      return child;
    },
    append(...children) {
      children.forEach((c) => this.appendChild(c));
    },
    remove() {
      if (this.parentElement) {
        const i = this.parentElement._children.indexOf(this);
        if (i >= 0) this.parentElement._children.splice(i, 1);
      }
      this.parentElement = null;
    },
    get children() {
      return this._children;
    },
    get firstChild() {
      return this._children[0] || null;
    },
    contains(node) {
      if (node === this) return true;
      return this._children.some((c) => c.contains(node));
    },
    querySelectorAll(sel) {
      const out = [];
      const attrMatch = sel.match(/^\[([a-zA-Z-]+)\]$/);
      const walk = (node) => {
        node._children.forEach((c) => {
          if (attrMatch && c._attrs[attrMatch[1]] !== undefined) out.push(c);
          else if (!attrMatch && c.tagName === sel.toUpperCase()) out.push(c);
          walk(c);
        });
      };
      walk(this);
      return out;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    getBoundingClientRect() {
      const left = this.style.left ? parseFloat(this.style.left) : this._x || 0;
      const top = this.style.top ? parseFloat(this.style.top) : this._y || 0;
      return { left, top, width: this.offsetWidth, height: this.offsetHeight };
    },
    focus() {},
    blur() {},
  };
  return el;
}

/** Installs global document/window/chrome mocks and returns them for assertions. */
function install() {
  const documentElement = makeElement("html");
  const byId = {};

  global.document = {
    documentElement,
    activeElement: null,
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => byId[id] || null,
    addEventListener: () => {},
  };

  // Track ids as elements are created with setAttribute("id", ...) via el().
  const originalCreateElement = global.document.createElement;
  global.document.createElement = (tag) => {
    const node = originalCreateElement(tag);
    const originalSetAttribute = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => {
      originalSetAttribute(name, value);
      if (name === "id") byId[value] = node;
    };
    return node;
  };

  global.window = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    AEB: {},
  };

  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  const storageChangeListeners = [];
  global.chrome = {
    storage: {
      onChanged: {
        addListener: (fn) => storageChangeListeners.push(fn),
      },
    },
  };

  return { documentElement, byId, window: global.window };
}

module.exports = { install, makeElement };

/**
 * Minimal DOM/browser stub so the wizard page (static/app.js) can be driven from Node in
 * tests. Only what the page actually touches is implemented.
 */

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
  contains(name) { return this.set.has(name); }
}

class Node {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.handlers = {};
    this.classList = new ClassList();
    this.style = {};
    this.attributes = {};
    this._text = "";
    this.value = "";
    this.disabled = false;
    this.href = "";
    this.title = "";
    this.type = "text";
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  get textContent() {
    if (this.tagName === "BR") return "\n";
    if (this.children.length) return this.children.map((c) => c.textContent).join("");
    return this._text;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._text; }
  get options() { return this.children.filter((c) => c.tagName === "OPTION"); }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  removeEventListener(type, fn) {
    this.handlers[type] = (this.handlers[type] || []).filter((h) => h !== fn);
  }
  remove() { this.removed = true; this.parentNode = null; }
  querySelector() { return null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
}

export const registry = new Map();

export const document = {
  readyState: "complete",
  getElementById(id) {
    if (!registry.has(id)) {
      const tag = id === "deployForm" ? "form"
        : id === "installButton" || id === "togglePassword" || id === "copyURL" ? "button"
        : id === "output" ? "pre"
        : id === "accountId" || id === "deployType" ? "select"
        : id === "liveUrl" || id === "tokenTemplate" ? "a"
        : "div";
      registry.set(id, new Node(tag));
    }
    return registry.get(id);
  },
  createElement(tag) { return new Node(tag); },
  addEventListener() {}
};

export function installGlobals(base) {
  const htmlClasses = new Set();
  const htmlElement = {
    tagName: "HTML",
    classList: {
      add: (name) => htmlClasses.add(name),
      remove: (name) => htmlClasses.delete(name),
      contains: (name) => htmlClasses.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !htmlClasses.has(name) : Boolean(force);
        if (on) htmlClasses.add(name); else htmlClasses.delete(name);
        return on;
      }
    }
  };
  document.documentElement = htmlElement;
  globalThis.document = document;
  globalThis.localStorage = {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); }
  };
  globalThis.window = globalThis;
  globalThis.location = { search: "", origin: base, pathname: "/", href: base + "/" };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.window.matchMedia = globalThis.matchMedia;
  globalThis.sessionStorage = {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); }
  };
  // Node 22 exposes `navigator` as a getter-only global; define a stub when needed.
  if (!globalThis.navigator || !globalThis.navigator.clipboard) {
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: async () => {} } },
      configurable: true,
      writable: true
    });
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => realFetch(
    typeof url === "string" && url.startsWith("/") ? new URL(url, base) : url,
    opts
  );
}

export async function fire(element, type, event = {}) {
  const handlers = element.handlers[type] || [];
  for (const handler of handlers) {
    await handler({ preventDefault() {}, ...event });
  }
}

export function textOf(node) {
  return node.textContent;
}

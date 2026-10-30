import { findBlockingDomain, hostnameOf } from "../shared/domain.js";
import { createStub } from "./stub.js";
import { detectTheme, watchTheme } from "./theme.js";

const HIDDEN = "data-rdb-hidden";
const STUB = "data-rdb-stub";
const RULE = `[${HIDDEN}]{display:none !important}`;
const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])";
const UNBLOCK_ERROR = "Couldn't unblock this domain. Reload the page and try again.";
const GENERIC_ERROR = "Something went wrong. Reload the page and try again.";

export function createBlocker({ document, adapter, getUrl, requestUnblock }) {
  let active = [];
  // post element -> { stub, id, href, domain, state, targets }
  let records = new WeakMap();
  const stubs = new WeakMap(); // stub element -> Stub
  const revealedIds = new Map(); // post id -> true, for this page load
  const revealedNodes = new WeakSet(); // posts that carry no id
  let started = false;
  let wasExcludedPage = false;
  let theme = "light";
  let style = null;
  let observer = null;
  let unwatchTheme = null;

  function onExcludedPage() {
    try {
      const url = getUrl();
      return adapter.isPostPage(url) || adapter.isSearchPage(url);
    } catch {
      return false;
    }
  }

  function isRevealed(post, id) {
    return id ? revealedIds.has(id) : revealedNodes.has(post);
  }

  function setRevealed(post, id, on) {
    if (id) {
      if (on) revealedIds.set(id, true);
      else revealedIds.delete(id);
    } else if (on) {
      revealedNodes.add(post);
    } else {
      revealedNodes.delete(post);
    }
  }

  function focusInto(post) {
    const target = post.matches(FOCUSABLE) ? post : post.querySelector(FOCUSABLE);
    if (target) target.focus();
  }

  // Mark or unmark the targets for rec.state and keep the stub right before the first target.
  // stubHadFocus must be read before any setState, which re-renders the stub's buttons.
  function place(post, rec, stubHadFocus = document.activeElement === rec.stub.element) {
    const targets = adapter.hideTarget(post);
    const first = targets[0];
    if (!first || !first.parentNode) return;
    const focused = document.activeElement;
    const hidden = rec.state === "hidden";
    const postHadFocus = hidden && Boolean(focused) && targets.some((t) => t.contains(focused));
    for (const t of rec.targets) if (!targets.includes(t)) t.removeAttribute(HIDDEN);
    for (const t of targets) {
      if (hidden) t.setAttribute(HIDDEN, "");
      else t.removeAttribute(HIDDEN);
    }
    rec.targets = targets;
    rec.stub.setTheme(theme);
    if (rec.stub.element.nextSibling !== first) first.parentNode.insertBefore(rec.stub.element, first);
    if (postHadFocus || (stubHadFocus && !rec.stub.element.shadowRoot.activeElement)) rec.stub.focusPrimary();
  }

  function restore(post, rec, clearRevealed) {
    const stubHadFocus = document.activeElement === rec.stub.element;
    for (const t of new Set([...rec.targets, ...adapter.hideTarget(post)])) t.removeAttribute(HIDDEN);
    rec.stub.element.remove();
    records.delete(post);
    if (clearRevealed) setRevealed(post, rec.id, false);
    if (stubHadFocus) focusInto(post);
  }

  function guarded(post, action) {
    return () => {
      const rec = records.get(post);
      if (!rec) return;
      try {
        action(rec);
      } catch {
        rec.stub.showError(GENERIC_ERROR);
      }
    };
  }

  function toggle(post, rec, revealed) {
    setRevealed(post, rec.id, revealed);
    const state = revealed ? "revealed" : "hidden";
    if (rec.state !== state) {
      rec.state = state;
      rec.stub.setState(state);
    }
    place(post, rec);
    rec.stub.focusPrimary();
  }

  async function unblock(post) {
    const rec = records.get(post);
    if (!rec) return;
    const { stub, domain } = rec;
    let ok = false;
    try {
      const result = await requestUnblock(domain);
      ok = Boolean(result && result.ok);
    } catch {
      ok = false;
    }
    if (!ok) stub.showError(UNBLOCK_ERROR);
  }

  function makeHandlers(post) {
    return {
      onShow: guarded(post, (rec) => toggle(post, rec, true)),
      onHide: guarded(post, (rec) => toggle(post, rec, false)),
      onUnblock: () => {
        unblock(post);
      },
    };
  }

  function evaluate(post) {
    const { id, href } = adapter.postInfo(post);
    const host = href ? hostnameOf(href) : null;
    const domain = host ? findBlockingDomain(host, active) : null;
    let rec = records.get(post);
    if (!domain) {
      if (rec) restore(post, rec, rec.id === id);
      return;
    }
    const stubHadFocus = Boolean(rec) && document.activeElement === rec.stub.element;
    const state = isRevealed(post, id) ? "revealed" : "hidden";
    if (!rec) {
      const stub = createStub(document, { domain, theme, state, handlers: makeHandlers(post) });
      stubs.set(stub.element, stub);
      rec = { stub, id, href, domain, state, targets: [] };
      records.set(post, rec);
    } else {
      if (rec.domain !== domain) rec.stub.setDomain(domain);
      if (rec.state !== state) rec.stub.setState(state);
      Object.assign(rec, { id, href, domain, state });
    }
    place(post, rec, stubHadFocus);
  }

  function postsIn(node) {
    if (node.nodeType !== 1 || node.hasAttribute(STUB)) return [];
    const found = adapter.findPosts(node);
    return adapter.isPost(node) ? [node, ...found] : found;
  }

  // A post detached on its own leaves its stub (and old-Reddit spacer marker) behind; clean those up.
  function dropOrphans(node) {
    for (const post of postsIn(node)) {
      const rec = records.get(post);
      if (!rec || post.isConnected) continue;
      rec.stub.element.remove();
      for (const t of rec.targets) if (t !== post && t.isConnected) t.removeAttribute(HIDDEN);
    }
  }

  function onMutations(mutations) {
    const postPage = onExcludedPage();
    const changed = new Set();
    for (const m of mutations) {
      if (m.type === "attributes") {
        if (!postPage && adapter.isPost(m.target)) changed.add(m.target);
        continue;
      }
      for (const node of m.removedNodes) dropOrphans(node);
      if (postPage) continue;
      for (const node of m.addedNodes) for (const post of postsIn(node)) changed.add(post);
    }
    for (const post of changed) if (post.isConnected) evaluate(post);
  }

  function scanAll() {
    if (!started || onExcludedPage()) return;
    for (const post of adapter.findPosts(document)) evaluate(post);
  }

  function onTheme(next) {
    theme = next;
    for (const el of document.querySelectorAll(`[${STUB}]`)) {
      const stub = stubs.get(el);
      if (stub) stub.setTheme(next);
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      style = document.createElement("style");
      style.textContent = RULE;
      (document.head || document.documentElement).append(style);
      theme = detectTheme(document);
      unwatchTheme = watchTheme(document, onTheme);
      wasExcludedPage = onExcludedPage();
      scanAll();
      observer = new document.defaultView.MutationObserver(onMutations);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: adapter.observedAttributes,
      });
    },
    stop() {
      if (!started) return;
      started = false;
      observer.disconnect();
      unwatchTheme();
      style.remove();
      for (const el of document.querySelectorAll(`[${STUB}]`)) el.remove();
      for (const el of document.querySelectorAll(`[${HIDDEN}]`)) el.removeAttribute(HIDDEN);
      records = new WeakMap();
    },
    setActiveDomains(domains) {
      active = Array.from(domains || []);
      scanAll();
    },
    handleUrlChange() {
      const now = onExcludedPage();
      const left = wasExcludedPage && !now;
      wasExcludedPage = now;
      if (left) scanAll();
    },
  };
}

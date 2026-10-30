import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { pickAdapter } from "../src/content/adapters.js";
import { createBlocker } from "../src/content/blocker.js";

const LISTING = "https://www.reddit.com/r/news/";
const POST_PAGE = "https://www.reddit.com/r/news/comments/1xiirhz/doordash/";

function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup({ url = LISTING, domains = ["example.com"], posts = [], unblock, onHit } = {}) {
  const dom = new JSDOM('<!doctype html><html class="theme-light"><head></head><body><main><shreddit-feed></shreddit-feed></main></body></html>');
  const document = dom.window.document;
  const feed = document.querySelector("shreddit-feed");
  const base = pickAdapter("www.reddit.com");
  const findPostsRoots = [];
  const adapter = {
    ...base,
    findPosts(root) {
      findPostsRoots.push(root);
      return base.findPosts(root);
    },
  };
  let currentUrl = url;
  const unblockCalls = [];
  const requestUnblock = (domain) => {
    unblockCalls.push(domain);
    return unblock ? unblock(domain) : Promise.resolve({ ok: true });
  };

  function makeArticle(id, href, name = "new-link") {
    const template = document.createElement("template");
    template.innerHTML = fixture(name);
    const article = template.content.firstElementChild;
    const post = article.querySelector("shreddit-post");
    if (id !== undefined) post.setAttribute("id", id);
    if (href !== undefined) post.setAttribute("content-href", href);
    return article;
  }

  for (const p of posts) feed.append(makeArticle(p.id, p.href, p.fixture));
  const blocker = createBlocker({ document, adapter, getUrl: () => currentUrl, requestUnblock, onHit });
  blocker.setActiveDomains(domains);

  const post = (id) => document.getElementById(id);
  const stubOf = (el) => {
    const prev = el.previousElementSibling;
    return prev && prev.hasAttribute("data-rdb-stub") ? prev : null;
  };
  const buttonIn = (stubEl, text) =>
    [...stubEl.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const stubText = (stubEl) => stubEl.shadowRoot.querySelector(".label").textContent;
  const setUrl = (u) => {
    currentUrl = u;
  };
  return { dom, document, feed, adapter, blocker, findPostsRoots, unblockCalls, makeArticle, post, stubOf, buttonIn, stubText, setUrl };
}

const isHidden = (el) => el.hasAttribute("data-rdb-hidden");

test("hides a post whose host matches and inserts a stub before it", () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/story" }] });
  const before = t.post("t3_a");
  const parent = before.parentElement;
  t.blocker.start();
  const p = t.post("t3_a");
  assert.equal(p, before, "node identity unchanged");
  assert.equal(p.parentElement, parent, "not moved");
  assert.ok(p.isConnected);
  assert.ok(isHidden(p));
  const stub = p.previousElementSibling;
  assert.ok(stub && stub.hasAttribute("data-rdb-stub"));
  const style = [...t.document.querySelectorAll("style")].find((s) => s.textContent.includes("data-rdb-hidden"));
  assert.ok(style, "style injected");
  assert.match(style.textContent.replace(/\s/g, ""), /\[data-rdb-hidden\]\{display:none!important;?\}/);
  t.blocker.stop();
});

test("matches subdomains, not lookalikes", () => {
  const t = setup({
    posts: [
      { id: "t3_sub", href: "https://news.example.com/a" },
      { id: "t3_look", href: "https://notexample.com/a" },
    ],
  });
  t.blocker.start();
  assert.ok(isHidden(t.post("t3_sub")));
  assert.ok(t.stubOf(t.post("t3_sub")));
  assert.ok(!isHidden(t.post("t3_look")));
  assert.equal(t.stubOf(t.post("t3_look")), null);
  t.blocker.stop();
});

test("never hides posts with no outbound link (self post, permalink crosspost)", () => {
  const t = setup({
    domains: ["example.com", "reddit.com", "v.redd.it"],
    posts: [{ fixture: "new-self" }, { fixture: "new-crosspost" }, { fixture: "new-gallery" }, { id: "t3_rel", href: "/r/x/comments/1/y/" }],
  });
  t.blocker.start();
  for (const id of ["t3_1xij36l", "t3_1xigfpg", "t3_1xicliv", "t3_rel"]) {
    assert.ok(!isHidden(t.post(id)), id);
    assert.equal(t.stubOf(t.post(id)), null, id);
  }
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);
  t.blocker.stop();
});

test("stub text names the matching entry, not the post host", () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://www.news.example.com/a" }] });
  t.blocker.start();
  const text = t.stubText(t.stubOf(t.post("t3_a")));
  assert.equal(text, "Hidden: example.com");
  t.blocker.stop();
});

test("posts added later are handled by the observer", async () => {
  const t = setup();
  t.blocker.start();
  t.feed.append(t.makeArticle("t3_late", "https://example.com/late"));
  await flush();
  const p = t.post("t3_late");
  assert.ok(isHidden(p));
  assert.ok(t.stubOf(p));
  t.feed.append(t.makeArticle("t3_ok", "https://other.org/x"));
  await flush();
  assert.ok(!isHidden(t.post("t3_ok")));
  t.blocker.stop();
});

test("does not rescan the whole document per mutation", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://other.org/a" }] });
  t.blocker.start();
  assert.deepEqual(t.findPostsRoots, [t.document], "start() scans the document once");
  t.findPostsRoots.length = 0;
  const article = t.makeArticle("t3_new", "https://example.com/n");
  t.feed.append(article);
  await flush();
  assert.ok(isHidden(t.post("t3_new")));
  assert.ok(!t.findPostsRoots.includes(t.document), "never rescans the document");
  assert.deepEqual(t.findPostsRoots, [article], "only the appended subtree is searched");
  t.blocker.stop();
});

test("Show post reveals one post only and survives re-scan; Hide post re-hides", () => {
  const t = setup({
    posts: [
      { id: "t3_a", href: "https://example.com/a" },
      { id: "t3_b", href: "https://example.com/b" },
    ],
  });
  t.blocker.start();
  const a = t.post("t3_a");
  const b = t.post("t3_b");
  t.buttonIn(t.stubOf(a), "Show post").click();
  assert.ok(!isHidden(a));
  assert.ok(isHidden(b));
  assert.equal(t.stubText(t.stubOf(a)), "Shown: example.com");
  assert.ok(t.buttonIn(t.stubOf(a), "Hide post"));

  t.blocker.setActiveDomains(["example.com", "other.org"]);
  assert.ok(!isHidden(a), "revealed survives rescan");
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 2, "no duplicate stubs");

  t.buttonIn(t.stubOf(a), "Hide post").click();
  assert.ok(isHidden(a));
  assert.equal(t.stubText(t.stubOf(a)), "Hidden: example.com");
  t.blocker.stop();
});

test("revealed state survives the node being detached and re-added (map keyed by id)", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  t.buttonIn(t.stubOf(a), "Show post").click();
  const article = a.parentElement;
  article.remove();
  await flush();
  t.feed.append(article);
  await flush();
  assert.ok(!isHidden(a));
  assert.equal(t.stubText(t.stubOf(a)), "Shown: example.com");
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 1);

  // A fresh node for the same post id is also revealed.
  article.remove();
  await flush();
  t.feed.append(t.makeArticle("t3_a", "https://example.com/a"));
  await flush();
  const fresh = t.post("t3_a");
  assert.notEqual(fresh, a);
  assert.ok(!isHidden(fresh));
  assert.equal(t.stubText(t.stubOf(fresh)), "Shown: example.com");
  t.blocker.stop();
});

test("a post node removed on its own takes its stub with it and gets it back when re-added", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  const article = a.parentElement;
  a.remove();
  await flush();
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0, "no orphaned stub");
  article.append(a);
  await flush();
  assert.ok(isHidden(a));
  assert.ok(t.stubOf(a));
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 1);
  t.blocker.stop();
});

test("setActiveDomains([]) restores posts: marker and stub gone, node identity unchanged", () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  t.buttonIn(t.stubOf(a), "Show post").click();
  t.blocker.setActiveDomains([]);
  assert.equal(t.post("t3_a"), a);
  assert.ok(!isHidden(a));
  assert.equal(t.stubOf(a), null);
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);
  // Revealed state was cleared: blocking again hides it.
  t.blocker.setActiveDomains(["example.com"]);
  assert.ok(isHidden(a));
  assert.equal(t.stubText(t.stubOf(a)), "Hidden: example.com");
  t.blocker.stop();
});

test("setActiveDomains adds a domain: matching posts hide without reload", () => {
  const t = setup({ domains: [], posts: [{ id: "t3_a", href: "https://other.org/a" }] });
  t.blocker.start();
  assert.ok(!isHidden(t.post("t3_a")));
  t.blocker.setActiveDomains(["other.org"]);
  assert.ok(isHidden(t.post("t3_a")));
  assert.equal(t.stubText(t.stubOf(t.post("t3_a"))), "Hidden: other.org");
  t.blocker.stop();
});

test("entry change: the stub names the most specific entry and follows its removal", () => {
  const t = setup({ domains: ["example.com", "news.example.com"], posts: [{ id: "t3_a", href: "https://news.example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  const stubEl = t.stubOf(a);
  assert.equal(t.stubText(stubEl), "Hidden: news.example.com");
  t.blocker.setActiveDomains(["example.com"]);
  assert.equal(t.stubOf(a), stubEl, "same stub reused");
  assert.equal(t.stubText(stubEl), "Hidden: example.com");
  assert.equal(t.buttonIn(stubEl, "Unblock domain").getAttribute("aria-label"), "Unblock domain example.com");
  t.blocker.stop();
});

test("recycled node: stub follows the new link, or is removed; old revealed state is not inherited", async () => {
  const t = setup({ domains: ["example.com", "other.org"], posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const node = t.post("t3_a");
  const stubEl = t.stubOf(node);
  t.buttonIn(stubEl, "Show post").click();
  assert.ok(!isHidden(node));

  node.setAttribute("content-href", "https://other.org/b");
  node.setAttribute("id", "t3_b");
  await flush();
  assert.ok(isHidden(node), "new post is hidden; revealed state of t3_a not inherited");
  assert.equal(t.stubOf(node), stubEl, "stub reused");
  assert.equal(t.stubText(stubEl), "Hidden: other.org");
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 1);

  node.setAttribute("content-href", "https://fine.net/c");
  node.setAttribute("id", "t3_c");
  await flush();
  assert.ok(!isHidden(node));
  assert.equal(t.stubOf(node), null);
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);

  // Recycled into a post with no outbound link: restored, never hidden.
  node.setAttribute("content-href", "https://example.com/d");
  node.setAttribute("id", "t3_d");
  await flush();
  assert.ok(isHidden(node));
  node.setAttribute("content-href", "/r/x/comments/1/y/");
  node.setAttribute("id", "t3_e");
  await flush();
  assert.ok(!isHidden(node));
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);

  // Going back to t3_a brings back its revealed state (keyed by id).
  node.setAttribute("content-href", "https://example.com/a");
  node.setAttribute("id", "t3_a");
  await flush();
  assert.ok(!isHidden(node));
  assert.equal(t.stubText(t.stubOf(node)), "Shown: example.com");
  t.blocker.stop();
});

test("post page: nothing hidden or restored; leaving rescans and hides", async () => {
  const t = setup({ url: POST_PAGE, posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  assert.ok(!isHidden(t.post("t3_a")));
  t.feed.append(t.makeArticle("t3_b", "https://example.com/b"));
  await flush();
  assert.ok(!isHidden(t.post("t3_b")));
  t.blocker.setActiveDomains(["example.com", "other.org"]);
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);

  t.setUrl(LISTING);
  t.blocker.handleUrlChange();
  assert.ok(isHidden(t.post("t3_a")));
  assert.ok(isHidden(t.post("t3_b")));

  // Entering a post page leaves existing stubs alone, even when the list changes.
  t.setUrl(POST_PAGE);
  t.blocker.handleUrlChange();
  t.blocker.setActiveDomains([]);
  assert.ok(isHidden(t.post("t3_a")));
  assert.ok(t.stubOf(t.post("t3_a")));

  // Leaving applies the current list.
  t.setUrl(LISTING);
  t.blocker.handleUrlChange();
  assert.ok(!isHidden(t.post("t3_a")));
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);
  t.blocker.stop();
});

test("search page: nothing hidden, new posts left alone, stubs left alone, leaving rescans", async () => {
  const SEARCH = "https://www.reddit.com/search/?q=example";
  const t = setup({ url: SEARCH, posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  assert.ok(!isHidden(t.post("t3_a")));
  t.feed.append(t.makeArticle("t3_b", "https://example.com/b"));
  await flush();
  assert.ok(!isHidden(t.post("t3_b")));
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);

  t.setUrl(LISTING);
  t.blocker.handleUrlChange();
  assert.ok(isHidden(t.post("t3_a")));
  assert.ok(isHidden(t.post("t3_b")));

  // Entering search leaves stubs already on screen alone.
  t.setUrl(SEARCH);
  t.blocker.handleUrlChange();
  t.blocker.setActiveDomains([]);
  assert.ok(isHidden(t.post("t3_a")));

  t.setUrl(LISTING);
  t.blocker.handleUrlChange();
  assert.ok(!isHidden(t.post("t3_a")));
  t.blocker.stop();
});

test("focus: hidden post hands focus to Show post; Show post -> Hide post; Hide post -> Show post", () => {
  const t = setup({ domains: [], posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  const link = a.querySelector("a");
  link.focus();
  assert.equal(t.document.activeElement, link);

  t.blocker.setActiveDomains(["example.com"]);
  const stubEl = t.stubOf(a);
  assert.equal(t.document.activeElement, stubEl);
  assert.equal(stubEl.shadowRoot.activeElement.textContent.trim(), "Show post");

  stubEl.shadowRoot.activeElement.click();
  assert.equal(t.document.activeElement, stubEl);
  assert.equal(stubEl.shadowRoot.activeElement.textContent.trim(), "Hide post");

  stubEl.shadowRoot.activeElement.click();
  assert.equal(t.document.activeElement, stubEl);
  assert.equal(stubEl.shadowRoot.activeElement.textContent.trim(), "Show post");
  t.blocker.stop();
});

test("focus: a recycled post that changes state keeps focus on the stub's primary button", async () => {
  const t = setup({ domains: ["example.com", "other.org"], posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const node = t.post("t3_a");
  const stubEl = t.stubOf(node);
  t.buttonIn(stubEl, "Show post").click();
  t.buttonIn(stubEl, "Hide post").focus();
  assert.equal(stubEl.shadowRoot.activeElement.textContent.trim(), "Hide post");

  // revealed -> hidden
  node.setAttribute("content-href", "https://other.org/b");
  node.setAttribute("id", "t3_b");
  await flush();
  assert.ok(isHidden(node));
  assert.equal(t.document.activeElement, stubEl);
  assert.equal(stubEl.shadowRoot.activeElement?.textContent.trim(), "Show post");

  // hidden -> revealed (back to the revealed id)
  node.setAttribute("content-href", "https://example.com/a");
  node.setAttribute("id", "t3_a");
  await flush();
  assert.ok(!isHidden(node));
  assert.equal(t.document.activeElement, stubEl);
  assert.equal(stubEl.shadowRoot.activeElement?.textContent.trim(), "Hide post");
  t.blocker.stop();
});

test("focus: restoring a post whose stub held focus moves focus into the post", () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  t.buttonIn(t.stubOf(a), "Show post").focus();
  t.blocker.setActiveDomains([]);
  assert.equal(t.document.activeElement, a.querySelector("a"));
  t.blocker.stop();
});

test("Unblock calls requestUnblock(matchingEntry); on { ok: false } the stub shows an error and the post stays hidden", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://news.example.com/a" }], unblock: () => Promise.resolve({ ok: false }) });
  t.blocker.start();
  const a = t.post("t3_a");
  const stubEl = t.stubOf(a);
  t.buttonIn(stubEl, "Unblock domain").click();
  await flush();
  assert.deepEqual(t.unblockCalls, ["example.com"]);
  assert.ok(stubEl.shadowRoot.querySelector("[role=alert]").textContent.length > 0);
  assert.ok(isHidden(a));
  t.blocker.stop();
});

test("Unblock that rejects or throws shows an error and never escapes into the page", async () => {
  for (const unblock of [
    () => Promise.reject(new Error("Extension context invalidated.")),
    () => {
      throw new Error("Extension context invalidated.");
    },
  ]) {
    const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }], unblock });
    const errors = [];
    t.dom.window.addEventListener("error", (e) => errors.push(e.error));
    t.blocker.start();
    const a = t.post("t3_a");
    const stubEl = t.stubOf(a);
    t.buttonIn(stubEl, "Unblock domain").click();
    await flush();
    assert.deepEqual(errors, []);
    assert.ok(stubEl.shadowRoot.querySelector("[role=alert]").textContent.length > 0);
    assert.ok(isHidden(a));
    t.blocker.stop();
  }
});

test("Unblock that succeeds leaves restoring to the next setActiveDomains", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const a = t.post("t3_a");
  const stubEl = t.stubOf(a);
  t.buttonIn(stubEl, "Unblock domain").click();
  await flush();
  assert.equal(stubEl.shadowRoot.querySelector("[role=alert]").textContent, "");
  t.blocker.setActiveDomains([]);
  assert.ok(!isHidden(a));
  assert.equal(t.stubOf(a), null);
  t.blocker.stop();
});

test("stubs follow Reddit's theme", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const bar = () => t.stubOf(t.post("t3_a")).shadowRoot.querySelector(".bar");
  assert.equal(bar().getAttribute("data-theme"), "light");
  t.document.documentElement.className = "theme-dark";
  await flush();
  assert.equal(bar().getAttribute("data-theme"), "dark");
  t.blocker.stop();
});

test("stop() disconnects the observer and removes the style, markers, and stubs", async () => {
  const t = setup({ posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  assert.ok(isHidden(t.post("t3_a")));
  t.blocker.stop();
  assert.ok(!isHidden(t.post("t3_a")));
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);
  assert.equal(t.document.querySelectorAll("[data-rdb-hidden]").length, 0);
  assert.ok(![...t.document.querySelectorAll("style")].some((s) => s.textContent.includes("data-rdb-hidden")));
  t.feed.append(t.makeArticle("t3_b", "https://example.com/b"));
  await flush();
  assert.ok(!isHidden(t.post("t3_b")), "observer disconnected");
  assert.equal(t.document.querySelectorAll("[data-rdb-stub]").length, 0);
});

test("old Reddit: post and spacer are both marked; stub sits before the post", () => {
  const dom = new JSDOM(`<!doctype html><html><body>${fixture("old-link")}</body></html>`);
  const document = dom.window.document;
  const blocker = createBlocker({
    document,
    adapter: pickAdapter("old.reddit.com"),
    getUrl: () => "https://old.reddit.com/r/news/",
    requestUnblock: () => Promise.resolve({ ok: true }),
  });
  blocker.setActiveDomains(["apnews.com"]);
  blocker.start();
  const thing = document.querySelector(".thing");
  const spacer = thing.nextElementSibling;
  assert.ok(isHidden(thing));
  assert.ok(isHidden(spacer));
  assert.ok(thing.previousElementSibling.hasAttribute("data-rdb-stub"));
  blocker.setActiveDomains([]);
  assert.ok(!isHidden(thing));
  assert.ok(!isHidden(spacer));
  assert.equal(document.querySelectorAll("[data-rdb-stub]").length, 0);
  blocker.stop();
});

test("onHit fires once per matching post with the matching entry", () => {
  const hits = [];
  const t = setup({
    onHit: (d) => hits.push(d),
    posts: [
      { id: "t3_a", href: "https://example.com/a" },
      { id: "t3_b", href: "https://news.example.com/b" },
      { id: "t3_c", href: "https://fine.net/c" },
    ],
  });
  t.blocker.start();
  assert.deepEqual(hits, ["example.com", "example.com"]);
  t.blocker.stop();
});

test("re-scans, Show/Hide post, and unblock-then-reblock do not count again", () => {
  const hits = [];
  const t = setup({ onHit: (d) => hits.push(d), posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  t.blocker.setActiveDomains(["example.com", "other.org"]);
  t.buttonIn(t.stubOf(t.post("t3_a")), "Show post").click();
  t.buttonIn(t.stubOf(t.post("t3_a")), "Hide post").click();
  t.blocker.setActiveDomains([]);
  t.blocker.setActiveDomains(["example.com"]);
  assert.deepEqual(hits, ["example.com"]);
  t.blocker.stop();
});

test("posts without an id are deduped by node", () => {
  const hits = [];
  const t = setup({ onHit: (d) => hits.push(d), posts: [{ href: "https://example.com/a" }] });
  t.blocker.start();
  t.blocker.setActiveDomains([]);
  t.blocker.setActiveDomains(["example.com"]);
  assert.deepEqual(hits, ["example.com"]);
  t.blocker.stop();
});

test("a recycled node with a new post id counts the new post; back to the old id does not", async () => {
  const hits = [];
  const t = setup({ onHit: (d) => hits.push(d), posts: [{ id: "t3_a", href: "https://example.com/a" }] });
  t.blocker.start();
  const node = t.post("t3_a");
  node.setAttribute("id", "t3_b");
  await flush();
  assert.equal(hits.length, 2);
  node.setAttribute("id", "t3_a");
  await flush();
  assert.equal(hits.length, 2);
  t.blocker.stop();
});

test("posts on a post page or search page are not counted", () => {
  for (const url of [POST_PAGE, "https://www.reddit.com/search/?q=x"]) {
    const hits = [];
    const t = setup({ url, onHit: (d) => hits.push(d), posts: [{ id: "t3_a", href: "https://example.com/a" }] });
    t.blocker.start();
    assert.deepEqual(hits, [], url);
    t.blocker.stop();
  }
});

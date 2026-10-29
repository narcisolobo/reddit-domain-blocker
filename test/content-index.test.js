import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { init } from "../src/content/index.js";

const LISTING = "https://www.reddit.com/r/news/";
const POST_PAGE = "https://www.reddit.com/r/news/comments/1xiirhz/doordash/";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const rec = (over = {}) => ({ s: "a", c: 1, u: 1, o: "o", ...over });

function article(id, href) {
  const html = readFileSync(new URL("./fixtures/new-link.html", import.meta.url), "utf8");
  const template = new JSDOM("").window.document.createElement("template");
  template.innerHTML = html;
  const el = template.content.firstElementChild;
  const post = el.querySelector("shreddit-post");
  post.setAttribute("id", id);
  post.setAttribute("content-href", href);
  return el.outerHTML;
}

async function setup({ items = {}, posts = [], withNavigation = true, url = LISTING } = {}) {
  const fake = createFakeChrome();
  await fake.storage.sync.set(items);
  const html = `<!doctype html><html class="theme-light"><head></head><body><main><shreddit-feed>${posts
    .map((p) => article(p.id, p.href))
    .join("")}</shreddit-feed></main></body></html>`;
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const location = { href: url, hostname: new URL(url).hostname };
  const navigation = withNavigation ? new EventTarget() : undefined;
  const target = new EventTarget();
  const intervals = [];
  const win = {
    navigation,
    addEventListener: (...args) => target.addEventListener(...args),
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
  };
  const blocker = await init({ chrome: fake, document, location, window: win });
  const post = (id) => document.getElementById(id);
  const isHidden = (id) => post(id).hasAttribute("data-rdb-hidden");
  return { fake, document, location, win, navigation, target, intervals, blocker, post, isHidden };
}

test("first scan uses the stored list: a matching post present at start is hidden", async () => {
  const t = await setup({
    items: {
      "d:example.com": rec(),
      "d:old.com": rec({ s: "x", x: 5 }),
      "d:bad.com": { nonsense: true },
      other: "foreign",
    },
    posts: [
      { id: "t3_a", href: "https://example.com/a" },
      { id: "t3_b", href: "https://old.com/b" },
      { id: "t3_c", href: "https://bad.com/c" },
    ],
  });
  assert.equal(t.isHidden("t3_a"), true);
  assert.equal(t.isHidden("t3_b"), false);
  assert.equal(t.isHidden("t3_c"), false);
});

test("onChanged in sync updates all posts; local-area changes are ignored", async () => {
  const t = await setup({
    posts: [
      { id: "t3_a", href: "https://example.com/a" },
      { id: "t3_b", href: "https://example.com/b" },
    ],
  });
  assert.equal(t.isHidden("t3_a"), false);
  await t.fake.storage.local.set({ "d:example.com": rec() });
  await flush();
  assert.equal(t.isHidden("t3_a"), false);
  await t.fake.storage.sync.set({ "d:example.com": rec() });
  await flush();
  assert.equal(t.isHidden("t3_a"), true);
  assert.equal(t.isHidden("t3_b"), true);
});

test("archived or removed record restores posts", async () => {
  const t = await setup({
    items: { "d:example.com": rec(), "d:other.com": rec() },
    posts: [
      { id: "t3_a", href: "https://example.com/a" },
      { id: "t3_b", href: "https://other.com/b" },
    ],
  });
  assert.equal(t.isHidden("t3_a"), true);
  await t.fake.storage.sync.set({ "d:example.com": rec({ s: "x", x: 9 }) });
  await flush();
  assert.equal(t.isHidden("t3_a"), false);
  await t.fake.storage.sync.remove("d:other.com");
  await flush();
  assert.equal(t.isHidden("t3_b"), false);
});

test("a slower earlier re-read does not overwrite a newer one", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    posts: [{ id: "t3_a", href: "https://example.com/a" }],
  });
  const stale = { "d:example.com": rec() };
  const fresh = {};
  let release;
  const gate = new Promise((r) => (release = r));
  const calls = [];
  t.fake.storage.sync.get = async () => {
    calls.push(1);
    if (calls.length === 1) {
      await gate;
      return stale;
    }
    return fresh;
  };
  // trigger two changes through the real listener path
  await t.fake.storage.sync.set({ "d:zzz.com": rec() });
  await t.fake.storage.sync.set({ "d:zzz.com": rec() });
  await flush();
  release();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(t.isHidden("t3_a"), false);
});

test("a rejected storage read keeps the previous list", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    posts: [{ id: "t3_a", href: "https://example.com/a" }],
  });
  t.fake.storage.sync.get = async () => {
    throw new Error("Extension context invalidated.");
  };
  await t.fake.storage.sync.set({ "d:x.com": rec() });
  await flush();
  assert.equal(t.isHidden("t3_a"), true);
});

test("requestUnblock sends domain/archive and resolves the response", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    posts: [{ id: "t3_a", href: "https://example.com/a" }],
  });
  const sent = [];
  t.fake.runtime.setMessageHandler((msg) => {
    sent.push(msg);
    return { ok: true };
  });
  const stub = t.post("t3_a").previousElementSibling;
  [...stub.shadowRoot.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === "Unblock domain")
    .click();
  await flush();
  assert.deepEqual(sent, [{ type: "domain/archive", domain: "example.com" }]);
  assert.equal(stub.shadowRoot.querySelector("[role=alert]").textContent, "");
});

test("requestUnblock resolves { ok: false } after invalidate, and the stub shows an error without throwing", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    posts: [{ id: "t3_a", href: "https://example.com/a" }],
  });
  t.fake.runtime.invalidate();
  const stub = t.post("t3_a").previousElementSibling;
  const button = [...stub.shadowRoot.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Unblock domain",
  );
  assert.doesNotThrow(() => button.click());
  await flush();
  const text = stub.shadowRoot.querySelector("[role=alert]").textContent;
  assert.ok(text.length > 0);
  // storage listener must not throw either once invalidated
  t.fake.storage.sync.get = async () => {
    throw new Error("Extension context invalidated.");
  };
  await assert.doesNotReject(t.fake.storage.sync.set({ "d:q.com": rec() }));
});

test("a non-object or malformed response resolves { ok: false }", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    posts: [{ id: "t3_a", href: "https://example.com/a" }],
  });
  t.fake.runtime.setMessageHandler(() => ({ ok: "yes" }));
  const stub = t.post("t3_a").previousElementSibling;
  [...stub.shadowRoot.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === "Unblock domain")
    .click();
  await flush();
  assert.ok(stub.shadowRoot.querySelector("[role=alert]").textContent.length > 0);
});

test("URL change via navigation currentchange triggers handleUrlChange", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    url: POST_PAGE,
    withNavigation: true,
  });
  // leaving the post page rescans: add a post while on the post page (not hidden)
  const feed = t.document.querySelector("shreddit-feed");
  feed.insertAdjacentHTML("beforeend", article("t3_n", "https://example.com/n"));
  await flush();
  assert.equal(t.isHidden("t3_n"), false);
  t.location.href = LISTING;
  t.navigation.dispatchEvent(new Event("currentchange"));
  assert.equal(t.isHidden("t3_n"), true);
  assert.equal(t.intervals.length, 0);
});

test("interval fallback triggers it when window.navigation is absent", async () => {
  const t = await setup({
    items: { "d:example.com": rec() },
    url: POST_PAGE,
    withNavigation: false,
  });
  const feed = t.document.querySelector("shreddit-feed");
  feed.insertAdjacentHTML("beforeend", article("t3_n", "https://example.com/n"));
  await flush();
  assert.equal(t.isHidden("t3_n"), false);
  assert.equal(t.intervals.length, 1);
  assert.equal(t.intervals[0].ms, 500);
  t.intervals[0].fn();
  assert.equal(t.isHidden("t3_n"), false);
  t.location.href = LISTING;
  t.intervals[0].fn();
  assert.equal(t.isHidden("t3_n"), true);
});

test("popstate triggers handleUrlChange", async () => {
  const t = await setup({ items: { "d:example.com": rec() }, url: POST_PAGE });
  const feed = t.document.querySelector("shreddit-feed");
  feed.insertAdjacentHTML("beforeend", article("t3_n", "https://example.com/n"));
  await flush();
  t.location.href = LISTING;
  t.target.dispatchEvent(new Event("popstate"));
  assert.equal(t.isHidden("t3_n"), true);
});

test("importing the module without chrome does not run init", () => {
  assert.equal(typeof init, "function");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { pickAdapter } from "../src/content/adapters.js";

const newAdapter = pickAdapter("www.reddit.com");
const oldAdapter = pickAdapter("old.reddit.com");

function load(name) {
  const html = readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
  return new JSDOM(html).window.document;
}

function newPost(name) {
  return newAdapter.findPosts(load(name))[0];
}

function oldPost(name) {
  return oldAdapter.findPosts(load(name))[0];
}

test("pickAdapter chooses by hostname", () => {
  assert.equal(pickAdapter("old.reddit.com").name, "old");
  assert.equal(pickAdapter("www.reddit.com").name, "new");
  assert.equal(pickAdapter("reddit.com").name, "new");
});

test("observedAttributes lists the link and id attributes", () => {
  assert.ok(newAdapter.observedAttributes.includes("content-href"));
  assert.ok(newAdapter.observedAttributes.includes("id"));
  assert.ok(oldAdapter.observedAttributes.includes("data-url"));
  assert.ok(oldAdapter.observedAttributes.includes("data-fullname"));
});

test("new: link post exposes id and outbound href", () => {
  assert.deepEqual(newAdapter.postInfo(newPost("new-link")), {
    id: "t3_1xiirhz",
    href: "https://apnews.com/article/doordash-instacart-delivery-d6f30f5d18c288eeba6babcb49260e06",
  });
});

test("new: self post, gallery post, and crosspost have href null", () => {
  for (const name of ["new-self", "new-gallery", "new-crosspost"]) {
    const info = newAdapter.postInfo(newPost(name));
    assert.equal(info.href, null, name);
    assert.ok(info.id, name);
  }
});

test("old: link post exposes id (data-fullname) and href (data-url)", () => {
  assert.deepEqual(oldAdapter.postInfo(oldPost("old-link")), {
    id: "t3_1xiirhz",
    href: "https://apnews.com/article/doordash-instacart-delivery-d6f30f5d18c288eeba6babcb49260e06",
  });
});

test("old: self post and gallery post have href null", () => {
  assert.equal(oldAdapter.postInfo(oldPost("old-self")).href, null);
  const gallery = oldPost("old-link");
  gallery.setAttribute("data-is-gallery", "true");
  gallery.setAttribute("data-url", "https://www.reddit.com/gallery/abc");
  gallery.setAttribute("data-domain", "old.reddit.com");
  assert.equal(oldAdapter.postInfo(gallery).href, null);
});

test("old: crosspost href comes from data-url (null in the fixture because the original is Reddit-hosted; with data-url set to an external URL it returns that URL)", () => {
  const post = oldPost("old-crosspost");
  assert.equal(oldAdapter.postInfo(post).href, null);
  post.setAttribute("data-url", "https://example.com/story");
  assert.equal(oldAdapter.postInfo(post).href, "https://example.com/story");
});

test("hideTarget returns the post node itself (new) and node plus spacer (old)", () => {
  const np = newPost("new-link");
  assert.deepEqual(newAdapter.hideTarget(np), [np]);
  const op = oldPost("old-link");
  const targets = oldAdapter.hideTarget(op);
  assert.equal(targets.length, 2);
  assert.equal(targets[0], op);
  assert.ok(targets[1].classList.contains("clearleft"));
});

test("old: hideTarget is just the node when no spacer follows", () => {
  const op = oldPost("old-link");
  op.nextElementSibling.remove();
  assert.deepEqual(oldAdapter.hideTarget(op), [op]);
});

test("findPosts finds every post under a root and none in an empty root", () => {
  const doc = new JSDOM("<main></main>").window.document;
  assert.deepEqual(newAdapter.findPosts(doc), []);
  assert.deepEqual(oldAdapter.findPosts(doc), []);

  const newHtml = ["new-link", "new-self", "new-gallery", "new-crosspost"]
    .map((n) => readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), "utf8"))
    .join("");
  assert.equal(newAdapter.findPosts(new JSDOM(`<main>${newHtml}</main>`).window.document).length, 4);

  const oldHtml = ["old-link", "old-self", "old-crosspost"]
    .map((n) => readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), "utf8"))
    .join("");
  assert.equal(oldAdapter.findPosts(new JSDOM(`<main>${oldHtml}</main>`).window.document).length, 3);
});

test("href null for hostile values", () => {
  const hostile = ["", "/r/x/comments/1/t/", "javascript:alert(1)", "mailto:a@b.c", "https://i.redd.it/x.png"];
  for (const value of hostile) {
    const np = newPost("new-link");
    np.setAttribute("content-href", value);
    assert.equal(newAdapter.postInfo(np).href, null, `new ${value}`);
    const op = oldPost("old-link");
    op.setAttribute("data-url", value);
    assert.equal(oldAdapter.postInfo(op).href, null, `old ${value}`);
  }
  const np = newPost("new-link");
  np.removeAttribute("content-href");
  assert.equal(newAdapter.postInfo(np).href, null);
  const op = oldPost("old-link");
  op.removeAttribute("data-url");
  assert.equal(oldAdapter.postInfo(op).href, null);
});

test("isPostPage", () => {
  for (const adapter of [newAdapter, oldAdapter]) {
    assert.equal(adapter.isPostPage("https://www.reddit.com/r/news/comments/abc123/some_title/"), true);
    assert.equal(adapter.isPostPage("https://old.reddit.com/r/news/comments/abc123/x/"), true);
    assert.equal(adapter.isPostPage("https://www.reddit.com/r/news/comments/abc123/"), true);
    assert.equal(adapter.isPostPage("https://www.reddit.com/r/news/comments/abc123"), true);
    for (const path of ["/", "/r/news/", "/r/all/top/?t=day", "/user/x/submitted/", "/search/?q=comments", "/r/comments/"]) {
      assert.equal(adapter.isPostPage("https://www.reddit.com" + path), false, path);
    }
    assert.equal(adapter.isPostPage("not a url"), false);
  }
});

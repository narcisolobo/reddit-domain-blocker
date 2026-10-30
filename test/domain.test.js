import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTED_DOMAINS,
  normalizeInput,
  isProtected,
  hostnameOf,
  findBlockingDomain,
} from "../src/shared/domain.js";

test("normalizes a pasted URL", () =>
  assert.deepEqual(normalizeInput("https://www.example.com:8080/a/b?c=d#e"), { ok: true, domain: "example.com" }));

test("messy input", () =>
  assert.equal(normalizeInput("  HTTPS://WWW.Example.COM.:8080/a?b=c#d ").domain, "example.com"));

test("bare host and host with path, no scheme", () => {
  assert.equal(normalizeInput("thedailybeast.com").domain, "thedailybeast.com");
  assert.equal(normalizeInput("thedailybeast.com/some-story").domain, "thedailybeast.com");
});

test("credentials dropped", () =>
  assert.equal(normalizeInput("https://u:p@news.example.com/").domain, "news.example.com"));

test("IDN becomes punycode", () =>
  assert.equal(normalizeInput("münchen.de").domain, "xn--mnchen-3ya.de"));

test("rejections", () => {
  assert.equal(normalizeInput("   ").reason, "empty");
  assert.equal(normalizeInput("not a domain").reason, "invalid");
  assert.equal(normalizeInput("mailto:a@b.com").reason, "invalid");
  assert.equal(normalizeInput("javascript:alert(1)").reason, "invalid");
  assert.equal(normalizeInput("ftp://a.com").reason, "invalid");
  assert.equal(normalizeInput("http://192.168.0.1/x").reason, "ip");
  assert.equal(normalizeInput("http://[::1]/").reason, "ip");
  assert.equal(normalizeInput("localhost").reason, "single-label");
});

test("protected domains and subdomains rejected, lookalike allowed", () => {
  for (const d of ["reddit.com", "old.reddit.com", "https://www.reddit.com/r/x", "redd.it", "i.redd.it", "redditmedia.com", "redditstatic.com"])
    assert.equal(normalizeInput(d).reason, "protected");
  assert.equal(normalizeInput("reddit.com.evil.com").ok, true);
  assert.equal(normalizeInput("notreddit.com").ok, true);
});

test("isProtected and PROTECTED_DOMAINS", () => {
  assert.deepEqual(PROTECTED_DOMAINS, ["reddit.com", "redd.it", "redditmedia.com", "redditstatic.com"]);
  assert.equal(isProtected("preview.redd.it"), true);
  assert.equal(isProtected("reddit.com.evil.com"), false);
});

test("hostnameOf", () => {
  assert.equal(hostnameOf("https://News.Example.com./x"), "news.example.com");
  for (const h of ["", "/r/x/comments/1", "javascript:alert(1)", "mailto:a@b.c", "data:text/html,x", "not a url", "ftp://a.com"])
    assert.equal(hostnameOf(h), null);
});

test("findBlockingDomain", () => {
  const list = ["example.com", "news.example.com"];
  assert.equal(findBlockingDomain("example.com", list), "example.com");
  assert.equal(findBlockingDomain("a.news.example.com", list), "news.example.com"); // longest match
  assert.equal(findBlockingDomain("notexample.com", list), null);
  assert.equal(findBlockingDomain("example.com.evil.com", list), null);
  assert.equal(findBlockingDomain("example.com", []), null);
});

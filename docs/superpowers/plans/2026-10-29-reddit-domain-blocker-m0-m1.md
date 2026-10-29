# Reddit Domain Blocker, M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inspect live Reddit (M0), then ship a loadable Chrome extension that hides posts by link domain with a hide-in-place stub, live updates across tabs, and an options page for adding and removing (archiving) domains (M1).

**Architecture:** Plain-JS ES modules under `src/`, bundled by esbuild into three classic scripts in `extension/` (content, background service worker, options). Pure logic (domain normalization, record encoding, blocklist writes, post matching) is tested with `node --test`; DOM behavior is tested with jsdom against HTML fixtures captured in M0; `chrome.*` is faked in tests. The service worker is the only storage writer; content scripts and the options page read storage and send messages.

**Tech Stack:** Node 20+, esbuild, jsdom, `@tabler/icons` (dev dependency, MIT; SVGs inlined at build), Chrome MV3.

**Spec:** [SPEC.md](../../../SPEC.md). Milestones M2 to M4 (archive section, counts, context menu, import/export, polish, accessibility sign-off) are out of scope; they get their own plan after M1.

## Global Constraints

Copied from the spec; every task includes them.

- Manifest V3; background is a service worker. `minimum_chrome_version`: `120`.
- Permissions in this plan: `storage` only (`contextMenus` arrives in M2). Content scripts matched to `*://*.reddit.com/*`, `run_at: document_start`. No broad host permissions, no `tabs`, no `activeTab`.
- Toolbar action click opens the options page.
- All code and assets bundled locally; no network requests, no remote code, no CDN.
- License MIT; Tabler Icons notice shipped in `THIRD_PARTY_LICENSES`.
- Sync storage: one item per domain, key `d:<hostname>`, compact value `{ s: "a"|"x", c, u, x?, o }` with epoch-ms times; `x` omitted while active.
- A match is host `=== d` or ends with `"." + d`, lowercase; archived domains never block; `example.com` must not match `notexample.com`.
- Protected domains never blockable: `reddit.com`, `redd.it`, `redditmedia.com`, `redditstatic.com` and their subdomains.
- Normalization: trim; accept with or without scheme; keep hostname only; lowercase; punycode IDNs; strip leading `www.`; reject empty, unparseable, IP addresses, single-label hosts, protected domains.
- Posts are hidden in place, never removed or moved: `display: none !important` via an injected stylesheet rule, stub inserted as a sibling.
- Posts with no outbound `http(s)` link (self posts, Reddit-hosted media, Reddit permalinks, relative or garbage URLs) are never hidden.
- Nothing is hidden or restored while the URL is a `/comments/` path; leaving it triggers a rescan.
- Stub: shadow-DOM isolated, matches Reddit's current theme (not the OS), `Hidden: <matching entry>`, **Show post** and **Unblock domain** buttons, each with an icon, text, `title` and `aria-label`.
- Show post reveals for the page load only (map keyed by post id); a revealed post can be collapsed back to the stub.
- Button styles: Add green, Remove red, everything else grey outlined.
- Options page follows `prefers-color-scheme`, system sans stack `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- WCAG 2.2 AA basics built in from the start (labels, roles, live regions, focus handling); sign-off is M4.

## Review Focus

The inputs and conditions the spec implies that a real user will hit. Each has a test in the task named in brackets.

1. Messy pasted input: `  HTTPS://WWW.Example.COM.:8080/a?b=c#d `, IDNs, IPs, `localhost`, empty, and the lookalike `reddit.com.evil.com`, which is not protected. [Task 4]
2. Malformed or foreign storage entries (missing fields, unknown keys, wrong types) must be ignored, not crash the content script or the options page. [Task 5]
3. Posts with `javascript:`, `mailto:`, relative, empty, or missing links are never hidden. [Task 8]
4. New Reddit recycles a post node for a different post: the stub must follow the new link, or disappear. [Task 11]
5. A hidden post that held keyboard focus, and Show post / collapse, must not strand focus. [Task 11]
6. The extension is reloaded while a Reddit tab is open: sending a message throws "Extension context invalidated"; the stub must show an error, not break the page. [Task 12]

---

### Task 1: M0 reconnaissance, `NOTES.md` and fixtures

**Files:**
- Create: `NOTES.md`
- Create: `test/fixtures/new-link.html`, `new-self.html`, `new-crosspost.html`, `new-gallery.html`, `old-link.html`, `old-self.html`, `old-crosspost.html`

**Interfaces:**
- Produces: `NOTES.md` with these headed sections, which Tasks 8, 9, 11, and 12 read: `## New Reddit post element`, `## Old Reddit post element`, `## Cross-posts`, `## Page types and URLs`, `## Navigation`, `## Theme signal`, `## Initial render`. Fixture files hold one post's `outerHTML` each, scripts removed, no personal data.

- [x] **Step 1: Load the Chrome tools** with one ToolSearch call (`tabs_context_mcp`, `navigate`, `read_page`, `get_page_text`, `javascript_tool`, `tabs_create_mcp`, `tabs_close_mcp`), then `tabs_context_mcp`. Open a new tab; do not reuse the user's tabs. If the tools are unavailable, ask the user to paste each element's outer HTML from DevTools instead.
- [x] **Step 2: Record the new-Reddit post element** at `https://www.reddit.com/r/news/`: tag, every attribute that carries the outbound link (`content-href` expected), the post id (`id`, `post-id`, or similar), post type, permalink, and how the list is nested (container, whether `shreddit-post` sits in an `article` or `faceplate` wrapper that should be hidden instead). Save one link post, one self post, one gallery or image post as `new-*.html`.
- [x] **Step 3: Record the old-Reddit post element** at `https://old.reddit.com/r/news/`: `.thing` attributes (`data-url`, `data-fullname`, `data-domain`, `data-permalink`), and which node to hide (the `.thing` and its adjacent `.clearleft` spacer). Save one link and one self post as `old-*.html`.
- [x] **Step 4: Record cross-posts** on both sites (`r/all` is deprecated; look in the home feed, `r/popular`, or a busy subreddit): what the link attribute holds, whether the original link is exposed anywhere in the node. Save as `new-crosspost.html` and `old-crosspost.html`. The plan's default is "treat a permalink as no outbound link".
- [x] **Step 5: Record page types and URLs**: listing, subreddit, search, profile (`/user/<name>/submitted`), post page, and the new-Reddit overlay case if it exists (open a post from a listing; note URL and whether the listing stays in the DOM). Also note any related-post lists on post pages.
- [x] **Step 6: Record navigation**: on new Reddit, click between a listing and a post and back; report whether the page reloads, whether `window.navigation` exists and fires `navigate`/`currentchange`, and whether `popstate` fires. This decides Task 12's URL-change detection.
- [x] **Step 7: Record the theme signal** on both sites (class or attribute on `html`/`body`, or a CSS color-scheme). Ask the user to switch Reddit's theme to the opposite of the OS setting once and record how the signal changes. Record the old-Reddit behavior with no theme control (expected: always light).
- [x] **Step 8: Record initial render**: are posts present in the server-rendered HTML (`curl` the listing and grep for the post tag), or injected later? This predicts the flash risk. The real flash measurement happens in Task 14, after the extension exists.
- [x] **Step 9: Verify.** `NOTES.md` has all seven headed sections, each with concrete selectors, attribute names, or URL patterns (no "TBD"), and the seven fixture files exist and contain no `<script`. Run: `grep -L "<script" test/fixtures/*.html | wc -l` → `7`.
- [x] **Step 10: Commit** `docs: record live Reddit markup findings and test fixtures`.

---

### Task 2: Project scaffold, manifest, build, fake chrome

**Files:**
- Create: `package.json`, `scripts/build.js`, `extension/manifest.json`, `extension/options.html` (empty shell for now), `test/helpers/fake-chrome.js`, `test/manifest.test.js`
- Modify: `.gitignore` (add `node_modules/`, `extension/content.js`, `extension/background.js`, `extension/options.js`), `README.md` (replace the "Building and installing" placeholder with `npm install`, `npm run build`, **Load unpacked** at `extension/`)

**Interfaces:**
- Produces: `npm test` (runs `node --test`), `npm run build` (esbuild, IIFE, entries `src/content/index.js`→`extension/content.js`, `src/background/index.js`→`extension/background.js`, `src/options/index.js`→`extension/options.js`; missing entry files are skipped with a warning until their task creates them).
- Produces `createFakeChrome(): FakeChrome` in `test/helpers/fake-chrome.js`: `storage.sync` and `storage.local` with `get(keys|null)`, `set(obj)`, `remove(keys)` returning Promises; `storage.onChanged.addListener(fn)` called as `fn(changes, areaName)` with `{key: {oldValue, newValue}}`; `fake.storage.sync.failNextSet(error)`; `runtime.sendMessage(msg)` → delegates to a handler set by `fake.runtime.setMessageHandler(fn)`, rejects with `Error("Extension context invalidated.")` after `fake.runtime.invalidate()`; `runtime.onMessage.addListener(fn)` and `fake.runtime.dispatchMessage(msg)` → Promise of the `sendResponse` value; `runtime.openOptionsPage` and `action.onClicked.addListener` with `fake.action.click()`.

- [x] **Step 1: Write the failing test** `test/manifest.test.js`:
  ```js
  test("manifest is MV3 with the spec's permissions", () => {
    const m = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
    assert.equal(m.manifest_version, 3);
    assert.equal(m.minimum_chrome_version, "120");
    assert.deepEqual(m.permissions, ["storage"]);
    assert.equal(m.host_permissions, undefined);
    assert.deepEqual(m.content_scripts[0].matches, ["*://*.reddit.com/*"]);
    assert.equal(m.content_scripts[0].run_at, "document_start");
    assert.equal(m.background.service_worker, "background.js");
    assert.equal(m.options_ui.open_in_tab, true);
  });
  ```
- [x] **Step 2: Run** `npm test` → FAIL (no manifest).
- [x] **Step 3: Create** `package.json` (`"type": "module"`, `"license": "MIT"`, author "Narciso Lobo", scripts, devDependencies `esbuild`, `jsdom`, `@tabler/icons`), `extension/manifest.json` (name "Reddit Domain Blocker", `action: {}` with no popup, `options_ui: {page: "options.html", open_in_tab: true}`), `scripts/build.js`, and the fake-chrome helper described above. Run `npm install`.
- [x] **Step 4: Run** `npm test` → PASS. Run `npm run build` → exits 0 with "skipped" warnings.
- [x] **Step 5: Commit** `chore: scaffold extension, build, and test helpers`.

---

### Task 3: Tabler icons and third-party notice

**Files:**
- Create: `scripts/gen-icons.js`, `src/shared/icons.js` (generated, committed), `THIRD_PARTY_LICENSES`, `test/icons.test.js`

**Interfaces:**
- Consumes: SVGs in `node_modules/@tabler/icons/icons/outline/`.
- Produces: `export function icon(name: IconName, size?: number): string`, returning inline SVG markup with `aria-hidden="true"`, `focusable="false"`, `width`/`height` = `size` (default 16), `stroke="currentColor"`. `IconName` = `"plus" | "trash" | "eye" | "eye-off" | "ban" | "arrow-back-up"`. (`eye-off` is added to the spec's icon list for the collapse control; this plan's call.) `npm run gen-icons` regenerates `src/shared/icons.js`.

- [x] **Step 1: Write the failing test** `test/icons.test.js`:
  ```js
  for (const name of ["plus","trash","eye","eye-off","ban","arrow-back-up"]) {
    test(`icon(${name}) is decorative inline svg`, () => {
      const svg = icon(name);
      assert.match(svg, /^<svg[^>]*aria-hidden="true"/);
      assert.match(svg, /stroke="currentColor"/);
    });
  }
  test("size is applied", () => assert.match(icon("plus", 20), /width="20"/));
  test("unknown name throws", () => assert.throws(() => icon("nope")));
  ```
- [x] **Step 2: Run** `node --test test/icons.test.js` → FAIL.
- [x] **Step 3: Implement** `scripts/gen-icons.js`: read the six SVG files, emit `src/shared/icons.js` with the `icon()` function above. Create `THIRD_PARTY_LICENSES` with Tabler's copyright line and MIT text copied from `node_modules/@tabler/icons/LICENSE`.
- [x] **Step 4: Run** `npm run gen-icons && node --test test/icons.test.js` → PASS.
- [x] **Step 5: Commit** `feat: add bundled Tabler icons and third-party notice`.

---

### Task 4: Domain normalization and matching

**Files:**
- Create: `src/shared/domain.js`, `test/domain.test.js`

**Interfaces:**
- Produces:
  - `export const PROTECTED_DOMAINS: string[]`
  - `export function normalizeInput(input: string): { ok: true, domain: string } | { ok: false, reason: "empty"|"invalid"|"ip"|"single-label"|"protected" }`
  - `export function isProtected(domain: string): boolean`
  - `export function hostnameOf(href: string): string | null` (http/https only, lowercase, no trailing dot, `null` otherwise)
  - `export function findBlockingDomain(hostname: string, activeDomains: Iterable<string>): string | null` (the longest matching entry)

- [x] **Step 1: Write the failing tests**:
  ```js
  test("normalizes a pasted URL", () =>
    assert.deepEqual(normalizeInput("https://www.example.com:8080/a/b?c=d#e"), { ok: true, domain: "example.com" }));
  test("messy input", () =>
    assert.equal(normalizeInput("  HTTPS://WWW.Example.COM.:8080/a?b=c#d ").domain, "example.com"));
  test("bare host and host with path, no scheme", () => {
    assert.equal(normalizeInput("thedailybeast.com").domain, "thedailybeast.com");
    assert.equal(normalizeInput("thedailybeast.com/some-story").domain, "thedailybeast.com");
  });
  test("credentials dropped", () => assert.equal(normalizeInput("https://u:p@news.example.com/").domain, "news.example.com"));
  test("IDN becomes punycode", () => assert.equal(normalizeInput("münchen.de").domain, "xn--mnchen-3ya.de"));
  test("rejections", () => {
    assert.equal(normalizeInput("   ").reason, "empty");
    assert.equal(normalizeInput("not a domain").reason, "invalid");
    assert.equal(normalizeInput("mailto:a@b.com").reason, "invalid");
    assert.equal(normalizeInput("http://192.168.0.1/x").reason, "ip");
    assert.equal(normalizeInput("http://[::1]/").reason, "ip");
    assert.equal(normalizeInput("localhost").reason, "single-label");
  });
  test("protected domains and subdomains rejected, lookalike allowed", () => {
    for (const d of ["reddit.com","old.reddit.com","https://www.reddit.com/r/x","redd.it","i.redd.it","redditmedia.com","redditstatic.com"])
      assert.equal(normalizeInput(d).reason, "protected");
    assert.equal(normalizeInput("reddit.com.evil.com").ok, true);
    assert.equal(normalizeInput("notreddit.com").ok, true);
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
  ```
- [x] **Step 2: Run** `node --test test/domain.test.js` → FAIL.
- [x] **Step 3: Implement** per the signatures. Use `new URL()` for parsing (prefix `https://` when the input has no `scheme://`); reject non-http(s) schemes; IP detection covers dotted IPv4 and bracketed IPv6.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: add domain normalization and matching`.

---

### Task 5: Compact record encoding

**Files:**
- Create: `src/shared/records.js`, `test/records.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const KEY_PREFIX = "d:"`
  - `export type DomainRecord = { domain: string, status: "active"|"archived", addedAt: number, updatedAt: number, archivedAt: number|null, source: "options"|"context-menu"|"stub"|"import" }`
  - `export function keyFor(domain: string): string`
  - `export function toStored(rec: DomainRecord): { s: "a"|"x", c: number, u: number, x?: number, o: "o"|"m"|"s"|"i" }`
  - `export function fromStored(key: string, stored: unknown): DomainRecord | null` (`null` when the key lacks the prefix or the value is malformed)
  - `export function recordsFromItems(items: Record<string, unknown>): DomainRecord[]` (skips anything `fromStored` rejects)
  - `export function activeDomains(records: DomainRecord[]): string[]`

- [x] **Step 1: Write the failing tests**:
  ```js
  test("round trip, active omits x", () => {
    const rec = { domain:"example.com", status:"active", addedAt:1793297667000, updatedAt:1793297667000, archivedAt:null, source:"options" };
    const stored = toStored(rec);
    assert.equal("x" in stored, false);
    assert.deepEqual(fromStored("d:example.com", stored), rec);
  });
  test("round trip, archived keeps x", () => {
    const rec = { domain:"a.com", status:"archived", addedAt:1, updatedAt:3, archivedAt:2, source:"stub" };
    assert.deepEqual(fromStored("d:a.com", toStored(rec)), rec);
  });
  test("a typical record stays compact", () =>
    assert.ok(("d:thedailybeast.com".length + JSON.stringify(toStored(rec)).length) < 130));
  test("malformed entries are ignored", () => {
    const items = { "d:ok.com": toStored(rec), "d:bad.com": { s: "zzz" }, "d:worse.com": "str", "d:n.com": null,
                    "other:key": toStored(rec), "d:t.com": { s:"a", c:"1", u:1, o:"o" } };
    assert.deepEqual(recordsFromItems(items).map(r => r.domain), ["ok.com"]);
  });
  test("activeDomains filters archived", () => assert.deepEqual(activeDomains([active, archived]), ["example.com"]));
  ```
- [x] **Step 2: Run** `node --test test/records.test.js` → FAIL.
- [x] **Step 3: Implement** per the signatures.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: add compact domain record encoding`.

---

### Task 6: Blocklist writes (background logic)

**Files:**
- Create: `src/background/blocklist.js`, `test/blocklist.test.js`

**Interfaces:**
- Consumes: `normalizeInput` (Task 4); `keyFor`, `toStored`, `recordsFromItems` (Task 5); a storage area with `get/set/remove` (the sync area, or the fake).
- Produces:
  - `export type AddResult = { ok: true, domain: string, outcome: "added"|"restored"|"exists" } | { ok: false, reason: "empty"|"invalid"|"ip"|"single-label"|"protected"|"quota"|"error" }`
  - `export function addDomain(area, input: string, source: DomainRecord["source"], now?: number): Promise<AddResult>`
  - `export function archiveDomain(area, domain: string, now?: number): Promise<{ ok: true, domain: string, outcome: "archived"|"already-archived" } | { ok: false, reason: "not-found"|"quota"|"error" }>`
  - `export function listRecords(area): Promise<DomainRecord[]>`
  - `export function handleMessage(msg, area, now?: number): Promise<object>` where `msg` is `{ type: "domain/add", input, source }` or `{ type: "domain/archive", domain }`; unknown types resolve `{ ok: false, reason: "error" }`.

- [x] **Step 1: Write the failing tests** (using `createFakeChrome().storage.sync`):
  ```js
  test("add stores a compact active record", async () => {
    const r = await addDomain(area, "https://www.thedailybeast.com/x?y=1", "options", 1000);
    assert.deepEqual(r, { ok: true, domain: "thedailybeast.com", outcome: "added" });
    assert.deepEqual((await area.get("d:thedailybeast.com"))["d:thedailybeast.com"], { s:"a", c:1000, u:1000, o:"o" });
  });
  test("adding an active domain again is a no-op that says so", async () => { /* outcome "exists", u unchanged */ });
  test("adding an archived domain restores it", async () => { /* outcome "restored", s "a", x removed, u = now, c unchanged, o unchanged */ });
  test("protected and invalid input write nothing", async () => { /* reasons protected, ip, empty; area.get(null) is {} */ });
  test("archive sets s x, x, u", async () => { /* outcome "archived", c unchanged */ });
  test("archiving twice is already-archived and leaves u alone", async () => {});
  test("archiving an unknown domain is not-found", async () => {});
  test("quota failure surfaces as reason quota", async () => {
    area.failNextSet(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"));
    assert.deepEqual(await addDomain(area, "a.com", "options"), { ok: false, reason: "quota" });
  });
  test("any other write failure is reason error", async () => {});
  test("handleMessage routes add and archive and rejects unknown types", async () => {});
  ```
- [x] **Step 2: Run** `node --test test/blocklist.test.js` → FAIL.
- [x] **Step 3: Implement** per the signatures. Quota detection: error message matches `/quota/i`.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: add blocklist add and archive operations`.

---

### Task 7: Service worker wiring

**Files:**
- Create: `src/background/index.js`, `test/background.test.js`

**Interfaces:**
- Consumes: `handleMessage` (Task 6); global `chrome` (injectable for tests via `export function init(chrome)`; the module calls `init(globalThis.chrome)` only when `chrome` exists).
- Produces: `export function init(chromeApi): void`: registers `runtime.onMessage` (returns `true` and responds asynchronously with `handleMessage(msg, chromeApi.storage.sync)`) and `action.onClicked` → `runtime.openOptionsPage()`.

- [x] **Step 1: Write the failing tests**:
  ```js
  test("add message writes sync storage and responds", async () => {
    const fake = createFakeChrome(); init(fake);
    const res = await fake.runtime.dispatchMessage({ type: "domain/add", input: "example.com", source: "options" });
    assert.equal(res.ok, true);
    assert.ok((await fake.storage.sync.get(null))["d:example.com"]);
  });
  test("toolbar click opens the options page", () => { init(fake); fake.action.click(); assert.equal(fake.runtime.openOptionsPage.calls, 1); });
  ```
- [x] **Step 2: Run** `node --test test/background.test.js` → FAIL.
- [x] **Step 3: Implement** per the signature.
- [x] **Step 4: Run** → PASS, then `npm run build` produces `extension/background.js`.
- [x] **Step 5: Commit** `feat: add service worker message handling`.

---

### Task 8: Reddit post adapters

**Files:**
- Create: `src/content/adapters.js`, `test/adapters.test.js`
- Reads: `NOTES.md`, `test/fixtures/*.html` (Task 1)

**Interfaces:**
- Consumes: `hostnameOf` (Task 4).
- Produces:
  - `export type PostInfo = { id: string | null, href: string | null }`
  - `export type Adapter = { name: "new"|"old", findPosts(root: ParentNode): Element[], postInfo(el: Element): PostInfo, hideTarget(el: Element): Element[], isPostPage(url: string): boolean }`. `hideTarget` returns every node that must be hidden for one post (old Reddit: the `.thing` plus its spacer, per NOTES); the first element is where the stub is inserted before.
  - `export function pickAdapter(hostname: string): Adapter` (`old.reddit.com` → old, otherwise new)
  - `postInfo.href` is the outbound link only when it is an `http(s)` URL whose host is not a protected Reddit domain; otherwise `null` (permalinks, relative URLs, `javascript:`/`mailto:`, empty).

- [x] **Step 1: Write the failing tests** using jsdom to load each fixture. Names and assertions (selectors and attribute names come from `NOTES.md`):
  - `new: link post exposes id and outbound href` (`postInfo(fixture).href` equals the fixture's real link; `id` equals its post id)
  - `new: self post, gallery post, and crosspost have href null`
  - `old: link post exposes id (data-fullname) and href (data-url)`; `old: self post and gallery post have href null`; `old: crosspost href comes from data-url (null in the fixture because the original is Reddit-hosted; with data-url set to an external URL it returns that URL)`
  - `hideTarget returns the post node itself (new) and node plus spacer (old)`
  - `findPosts finds every post under a root and none in an empty root`
  - `href null for hostile values`: set the link attribute to each of `""`, `"/r/x/comments/1/t/"`, `"javascript:alert(1)"`, `"mailto:a@b.c"`, `"https://i.redd.it/x.png"`, remove the attribute entirely → `null` each time
  - `isPostPage`: true for `https://www.reddit.com/r/news/comments/abc123/some_title/`, `https://old.reddit.com/r/news/comments/abc123/x/`, and `.../comments/abc123/`; false for `/`, `/r/news/`, `/r/all/top/?t=day`, `/user/x/submitted/`, `/search/?q=comments`, `/r/comments/` (subreddit named "comments")
- [x] **Step 2: Run** `node --test test/adapters.test.js` → FAIL.
- [x] **Step 3: Implement** per the signatures. `isPostPage` matches `/comments/<id>` as a path segment pair (`/\/comments\/[a-z0-9]+(\/|$)/i`) against the URL path only.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: add new and old Reddit post adapters`.

---

### Task 9: Reddit theme detection

**Files:**
- Create: `src/content/theme.js`, `test/theme.test.js`
- Reads: `NOTES.md` section `## Theme signal`

**Interfaces:**
- Produces:
  - `export function detectTheme(document: Document): "light" | "dark"`: uses the signal recorded in NOTES; primary signal on new Reddit is the `theme-dark` class on `html` (NOTES); if absent, falls back to the computed `color-scheme` of `html` (`dark` → dark), then to the luminance of the first non-transparent computed background among `body` and `html` (dark when luminance < 0.5). Body is transparent on new Reddit, so `body` alone is not enough.
  - `export function watchTheme(document: Document, callback: (theme: "light"|"dark") => void): () => void`: a `MutationObserver` on the attributes NOTES names (on `documentElement` and `body`); calls back only when the theme changes; the returned function disconnects.

- [x] **Step 1: Write the failing tests** (jsdom documents built from the signals in NOTES):
  - `detectTheme returns dark for the dark signal` / `light for the light signal` / `light when no signal and body background is white` / `dark when no signal and body background is rgb(11, 20, 22)`
  - `watchTheme calls back once on a change, not on unrelated attribute edits`, and `returned function stops callbacks`
- [x] **Step 2: Run** `node --test test/theme.test.js` → FAIL.
- [x] **Step 3: Implement** per the signatures.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: detect Reddit's current theme`.

---

### Task 10: The stub component

**Files:**
- Create: `src/content/stub.js`, `test/stub.test.js`

**Interfaces:**
- Consumes: `icon` (Task 3).
- Produces:
  - `export type StubHandlers = { onShow(): void, onHide(): void, onUnblock(): void }`
  - `export function createStub(document: Document, opts: { domain: string, theme: "light"|"dark", state: "hidden"|"revealed", handlers: StubHandlers }): Stub`
  - `Stub = { element: HTMLElement, setState(s): void, setDomain(d): void, setTheme(t): void, showError(message: string): void, focusPrimary(): void }`
  - `element` is a custom host (`<div data-rdb-stub>`) with an open shadow root containing a `role="group"` bar labelled `Hidden post from <domain>`. State `hidden`: text `Hidden: <domain>`, buttons **Show post** (eye, grey outlined) and **Unblock domain** (arrow-back-up, grey outlined). State `revealed`: text `Shown: <domain>`, buttons **Hide post** (eye-off) and **Unblock domain**. Every button: icon, visible text, `title` and `aria-label` (`Show post`, `Hide post`, `Unblock <domain>`; each contains the visible text). `showError` writes into a `role="alert"` region inside the shadow root. Theme is a `data-theme` attribute on the group driving CSS custom properties (light and dark palettes, 4.5:1 text and 3:1 border contrast). The shadow root carries its own `<style>`; nothing leaks in or out. Dashed border, system font stack, visible focus ring.

- [x] **Step 1: Write the failing tests** (jsdom):
  - `renders hidden state text and buttons in a shadow root` (host `shadowRoot.querySelector('[role=group]')` has `aria-label` `Hidden post from example.com`; text `Hidden: example.com`; buttons named `Show post` and `Unblock example.com`)
  - `buttons have icon, title and aria-label` (each button contains an `svg[aria-hidden=true]` and a `title`)
  - `click Show post calls onShow; click Unblock calls onUnblock`
  - `setState('revealed') swaps to Shown: text and Hide post button; Hide post calls onHide`
  - `setTheme updates data-theme; setDomain updates text, group label, and Unblock name`
  - `showError renders role=alert text and clears when state changes`
  - `host styles do not leak: document-level CSS selecting 'button' does not apply` (assert the shadow root has its own style element and the buttons are not in the light DOM)
  - `focusPrimary focuses Show post in hidden state and Hide post in revealed state`
- [x] **Step 2: Run** `node --test test/stub.test.js` → FAIL.
- [x] **Step 3: Implement** per the signatures.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: add shadow-DOM stub for hidden posts`.

---

### Task 11: The blocker (scan, hide in place, live updates)

**Files:**
- Create: `src/content/blocker.js`, `test/blocker.test.js`

**Interfaces:**
- Consumes: `Adapter`/`PostInfo` (Task 8), `createStub`/`StubHandlers` (Task 10), `findBlockingDomain` (Task 4), `detectTheme`/`watchTheme` (Task 9).
- Produces:
  - `export function createBlocker(deps: { document: Document, adapter: Adapter, getUrl(): string, requestUnblock(domain: string): Promise<{ ok: boolean }> }): Blocker`
  - `Blocker = { start(): void, stop(): void, setActiveDomains(domains: string[]): void, handleUrlChange(): void }`
  - Behavior: injects one `<style>` with `[data-rdb-hidden]{display:none !important}` into `document.documentElement`; marks each blocked post's `hideTarget` nodes with `data-rdb-hidden` and inserts a stub before the first target; never removes or moves a post node. `start()` scans all posts and starts a `MutationObserver` (childList + subtree, plus attributes on the adapter's link and id attributes) that processes only added nodes and changed posts, synchronously in the observer callback. A per-page-load `Map<postId, "revealed">`; revealed posts keep their stub in `revealed` state and are not re-hidden. While `adapter.isPostPage(getUrl())` is true nothing is hidden or restored; `handleUrlChange()` re-evaluates the URL and does a full rescan on leaving a post page. `setActiveDomains` rescans: hides new matches, restores posts whose domain is no longer blocked (remove marker and stub), updates a stub whose matching entry changed, and clears revealed state for restored posts. A post node reused for a different post (id or link changed) is re-evaluated, and its old stub is reused or removed.

- [x] **Step 1: Write the failing tests** (jsdom, new-Reddit fixture posts inserted into a listing):
  - `hides a post whose host matches and inserts a stub before it` (post node still in the DOM, marked, stub is `previousElementSibling`)
  - `matches subdomains, not lookalikes`: `news.example.com` hidden for `example.com`; `notexample.com` untouched
  - `never hides posts with no outbound link` (self post, permalink crosspost)
  - `stub text names the matching entry, not the post host`
  - `posts added later are handled by the observer` (append a matching post; after `await` microtask it is hidden and stubbed)
  - `does not rescan the whole document per mutation` (spy on `adapter.findPosts` call count: one for `start()`, none for a single appended post subtree's non-matching nodes beyond that subtree)
  - `Show post reveals one post only and survives re-scan; Hide post re-hides`
  - `revealed state survives the node being detached and re-added` (map keyed by id)
  - `setActiveDomains([]) restores posts: marker and stub gone, node identity unchanged`
  - `setActiveDomains adds a domain: matching posts hide without reload`
  - `entry change: with example.com and news.example.com active, stub says news.example.com; removing the latter updates the stub to example.com`
  - `recycled node: same element gets a new link and id; stub follows (new domain) or is removed (no match); old revealed state is not inherited`
  - `post page: nothing hidden when getUrl() is a comments URL; stubs already present are left alone; handleUrlChange after leaving rescans and hides`
  - `focus: when a post that contains document.activeElement is hidden, focus moves to the stub's Show post button; Show post moves focus to Hide post; Hide post returns it to Show post`
  - `Unblock calls requestUnblock(matchingEntry); on { ok: false } the stub shows an error and the post stays hidden`
  - `stop() disconnects the observer and removes the style, markers, and stubs`
- [x] **Step 2: Run** `node --test test/blocker.test.js` → FAIL.
- [x] **Step 3: Implement** per the interface. Keep a `WeakMap<Element, { stub: Stub, id: string | null, href: string | null, domain: string }>` per post; stub theme comes from `detectTheme`, updated through `watchTheme`.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: hide matching posts in place with live updates`.

---

### Task 12: Content script entry

**Files:**
- Create: `src/content/index.js`, `test/content-index.test.js`

**Interfaces:**
- Consumes: `pickAdapter` (Task 8), `createBlocker` (Task 11), `recordsFromItems`, `activeDomains` (Task 5), message shape `{ type: "domain/archive", domain }` (Task 6).
- Produces: `export async function init(env: { chrome, document, location, window }): Promise<Blocker>`; the module calls `init` with the globals when `chrome?.runtime?.id` exists.
  - Reads `chrome.storage.sync.get(null)` once, calls `setActiveDomains(activeDomains(recordsFromItems(items)))` before `start()` so the first scan already knows the list; listens to `chrome.storage.onChanged` (area `"sync"` only) and re-reads the full list on change.
  - `requestUnblock(domain)` sends `chrome.runtime.sendMessage({ type: "domain/archive", domain })`; any thrown error (including "Extension context invalidated.") resolves `{ ok: false }`.
  - URL changes: if `window.navigation` exists, listen to `currentchange`; also listen to `popstate`; fall back to a 500 ms interval comparing `location.href` (use what NOTES recommends first; the others are additive). Each calls `blocker.handleUrlChange()`.

- [ ] **Step 1: Write the failing tests**:
  - `first scan uses the stored list: a matching post present at start is hidden` (active + archived + malformed records in the fake sync area; only the active domain blocks)
  - `onChanged in sync updates all posts; local-area changes are ignored`
  - `archived or removed record restores posts`
  - `requestUnblock sends domain/archive and resolves the response`
  - `requestUnblock resolves { ok: false } after fake.runtime.invalidate()`, and the stub shows an error without throwing
  - `URL change via navigation currentchange triggers handleUrlChange` and `interval fallback triggers it when window.navigation is absent`
- [ ] **Step 2: Run** `node --test test/content-index.test.js` → FAIL.
- [ ] **Step 3: Implement** per the interface.
- [ ] **Step 4: Run** → PASS, then `npm run build` produces `extension/content.js`.
- [ ] **Step 5: Commit** `feat: wire content script to storage, messages, and navigation`.

---

### Task 13: Options page

**Files:**
- Create: `src/options/view.js`, `src/options/index.js`, `extension/options.css`, `test/options.test.js`
- Modify: `extension/options.html`

**Interfaces:**
- Consumes: `icon` (Task 3), `recordsFromItems` (Task 5), messages `domain/add` and `domain/archive` (Task 6).
- Produces:
  - `export function messageFor(result: AddResult | ArchiveResult): { kind: "status"|"error", text: string }`: `Added thedailybeast.com`, `Restored example.com`, `example.com is already on the list`, `Removed example.com` (archived), and one fix-saying error per reason (`invalid`: "That doesn't look like a web address. Try something like example.com."; `protected`: "Reddit's own domains can't be blocked."; `ip`, `single-label`, `empty`, `quota`: "The list is full. Remove some domains and try again."; `error`).
  - `export function renderList(root: HTMLElement, records: DomainRecord[], handlers: { onRemove(domain: string): void }): void`: active records only, sorted by domain; `<table>` with `<caption>Blocked domains</caption>`, `<th scope="col">` headers (`Domain`, actions column with visually hidden text `Actions`), one row per domain with a **Remove** button (trash icon, visible text `Remove`, `aria-label` `Remove <domain>`, `title` `Archive <domain>`, red); an empty state ("No blocked domains yet. Paste one above, or right-click a link on Reddit once that menu is added.") replaces the table when empty.
  - `export function init(env: { chrome, document }): Promise<void>`: builds the page, loads and renders the list, re-renders on `chrome.storage.onChanged` for the sync area.
  - `extension/options.html`: `lang="en"`, `<title>Reddit Domain Blocker options</title>`, one `<h1>`, `<main>`, a `<form>` with a visible `<label for="domain-input">Domain or URL</label>`, an input, and a green **Add** button (plus icon), a `role="status"` region and a `role="alert"` region. `options.css`: light and dark via `prefers-color-scheme`, the system sans stack, generous vertical row spacing, visible focus rings, secondary-grey and red and green button classes.

- [ ] **Step 1: Write the failing tests** (jsdom):
  - `messageFor` cases for every outcome and reason above, including `kind` values
  - `renderList shows active domains only, sorted, with caption and th scope=col`
  - `Remove button: visible text "Remove", aria-label "Remove example.com", title "Archive example.com", contains an aria-hidden svg`
  - `empty list shows the empty state and no table`
  - `submitting the form sends domain/add with the input value and source "options"; success shows the status text, clears the input, and keeps focus on the input; Enter in the input submits`
  - `a rejected input sets aria-invalid=true and aria-describedby pointing at the error text, announced in the role=alert region; the status region is empty`
  - `clicking Remove sends domain/archive; the status region announces "Removed example.com"; focus moves to the next row's Remove button, or the input when none remain`
  - `an external storage change (a domain added elsewhere) re-renders the list without a reload`
  - `a malformed record in storage is ignored`
- [ ] **Step 2: Run** `node --test test/options.test.js` → FAIL.
- [ ] **Step 3: Implement** per the interfaces.
- [ ] **Step 4: Run** → PASS, then `npm run build` produces `extension/options.js`.
- [ ] **Step 5: Commit** `feat: add options page for adding and removing domains`.

---

### Task 14: Live verification and M1 sign-off

**Files:**
- Modify: `NOTES.md` (add `## M1 verification` with results), `README.md` (status line)

**Interfaces:** none.

- [ ] **Step 1: Build and load.** `npm test` → all pass. `npm run build`. Load `extension/` unpacked at `chrome://extensions` (ask the user to do this and enable it if the Chrome tools cannot).
- [ ] **Step 2: Walk the M1 acceptance items** from the spec on live Reddit, recording pass or fail and any selector fixes in `NOTES.md`:
  - **1:** with `thedailybeast.com` added via the options page, stubs appear on the home feed, a subreddit, search, and a profile, on both old and new Reddit; a post's own page hides nothing.
  - **2:** a `www.` and a subdomain link are hidden; a lookalike host is not.
  - **3:** scrolling loads more posts that are hidden without breaking scroll.
  - **4:** adding a domain on the options page hides matching posts in all open Reddit tabs without a reload.
  - **5:** Show post reveals one post; Unblock domain removes the stub and restores the post in every open tab.
  - **9:** the stub follows Reddit's theme when the user switches it opposite to the OS; the options page follows the OS.
  - **12:** on new Reddit, if a post opens in an overlay above a listing (per NOTES), existing stubs stay and nothing new hides; closing it rescans.
  - **14:** inspect a hidden post in DevTools: the node is still in the page, marked `data-rdb-hidden`; removing the marker and the stub shows it.
- [ ] **Step 3: Measure the flash** (spec 4.2): on cold load and on infinite scroll, on both sites, record whether blocked posts visibly paint before hiding (use a screen recording or a Performance trace via the Chrome tools). Record the result and, if posts do flash, note that the pre-paint step in 4.2 is a candidate for M4.
- [ ] **Step 4: Fix** any failure by adding a failing test first in the owning task's test file, then the fix, then re-run `npm test`.
- [ ] **Step 5: Commit** `docs: record M1 verification results`.

---

## Self-Review

**Spec coverage (M0 + M1 scope):** matching 4.1 → Tasks 4, 8, 11; where it runs 4.2 and URL rule → Tasks 8, 11, 12; flash note → Task 14; protected domains 4.3 → Task 4; stub 4.4 → Tasks 10, 11; live updates 4.5 → Tasks 11, 12; archive on remove 4.6 → Task 6 (Archived section, Restore button, and permanent delete are M2); normalization 5.1 → Task 4; active list 5.2 → Task 13 (counts column is M2); data model 3.1 → Tasks 5, 6; write path 3.2a → Tasks 6, 7, 12; accessibility basics 6.2, 6.3 → Tasks 10, 11, 13; license and third-party notice → Tasks 2, 3. Deferred to later plans: stats and counts 3.2/3.3, context menu 4.7, Archived section 5.3, export/import 5.4/5.5, button polish and small-viewport behavior 5.6, forced-colors, reflow, 6.5 verification.

**Type consistency:** `PostInfo`, `Adapter` (Task 8) match their use in Task 11; `StubHandlers`/`Stub` (Task 10) match Task 11; message shapes (Task 6) match Tasks 7, 12, 13; `DomainRecord` (Task 5) matches Tasks 6 and 13; `AddResult` reasons match `messageFor`.

**Plan calls to review:** esbuild and jsdom as dev dependencies and the `extension/` output directory; `eye-off` icon added for the collapse control; stub text for a revealed post (`Shown: <domain>`) and its **Hide post** button; longest-matching entry names the stub; the flash measurement moved from M0 to Task 14 because it needs the extension to exist.

# Reddit Domain Blocker, M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Archived section (Restore, two-step Delete permanently), per-domain "Posts hidden" counts, and the **Block this domain** right-click menu to the M1 extension.

**Architecture:** Same layout as M1: ES modules under `src/`, bundled by esbuild into `extension/`. The service worker stays the only storage writer. It gains three message types (`domain/restore`, `domain/delete`, `stats/hits`), a context-menu handler, and a `{ sync, local }` pair of storage areas in place of the single sync area. Content scripts count hidden posts, batch the counts, and send them to the worker. They also show a small shadow-DOM notice when a right-click is refused. The options page reads both areas. It re-renders on sync changes and updates count cells in place on local changes.

**Tech Stack:** Node 20+, esbuild, jsdom, `@tabler/icons`, Chrome MV3 (`storage`, `contextMenus`).

**Spec:** [SPEC.md](../../../SPEC.md), milestone M2 in section 10. M3 (import/export) and M4 (polish, accessibility sign-off) are out of scope.

## Global Constraints

Every task includes these, plus the M1 plan's constraints ([2026-10-29-reddit-domain-blocker-m0-m1.md](2026-10-29-reddit-domain-blocker-m0-m1.md)), which still hold.

- Permissions become exactly `["storage", "contextMenus"]`. Still no `tabs`, no `activeTab`, no host permissions.
- The service worker is the only writer to `chrome.storage.sync` and `chrome.storage.local`, and it handles every message on one serialized queue (the existing one in `src/background/index.js`).
- Stats live in `chrome.storage.local` under the key `stats:<hostname>`, value `{ "blockedCount": number, "lastBlockedAt": epoch ms | null }`. They are keyed by domain, not by status. Archive and restore leave them alone, and only Delete permanently removes them.
- A post counts once per page load (dedupe by post id, else by node). Re-hiding a recycled node does not count. A reload counts again.
- Content scripts batch counts with a debounce of about 500 ms: one message per batch.
- Delete permanently exists only in the Archived section and takes two steps. The first click shows an inline "Really delete? Confirm / Cancel". Never use `window.confirm`. A delete removes both the sync record and the local stats.
- Focus (6.2): the first Delete click moves focus to Confirm. Escape or Cancel returns focus to that row's Delete. After a confirmed delete, focus goes to the next row's first control, else the previous row's, else the Archived heading.
- Menu: id `block-domain`, title **Block this domain**, `contexts: ["link"]`, `documentUrlPatterns: ["*://*.reddit.com/*"]`. The domain comes from `info.linkUrl`, normalized as in 5.1, with `source: "context-menu"`. On success, the hiding is the confirmation. A refusal (protected, invalid, quota) is explained to the user.
- Protected domains (`reddit.com`, `redd.it`, `redditmedia.com`, `redditstatic.com` and their subdomains) are refused from every entry point. `normalizeInput` already does this, and every new path must go through it.
- Button styles: Restore and Cancel are grey outlined. Delete permanently and Confirm are red. Every button has an icon, a visible label, a `title`, and an `aria-label` that contains the visible label (2.5.3).
- Status text goes to `role="status"` and errors to `role="alert"`, without moving focus (4.1.3).

## Review Focus

These are the conditions a user will run into that the spec doesn't spell out. Each one has a test in the task named in brackets.

1. A stats batch from a Reddit tab lands just after Delete permanently. It must not bring the deleted domain's count back, so hits for a domain with no sync record are dropped. [Task 1]
2. The options page is open while the user scrolls Reddit in another tab. Count updates must not close an open delete confirmation, move focus, or rebuild the tables. [Task 5]
3. Two Reddit tabs send counts for the same domain at the same moment. Both increments must land. [Task 1]
4. A right-click on a Reddit permalink, a user link, or a `mailto:` link must show an explanation and write nothing. A tab without the content script (opened before install) must not cause an uncaught error in the worker. [Task 6]
5. A malformed `stats:` value in local storage, or a malformed `stats/hits` message, must be ignored rather than crash the options page or the worker. That covers negative, fractional, `NaN`, string, or huge counts, protected or unnormalized domains, and non-object `hits`. [Tasks 1 and 4]

---

### Task 1: Stats storage and the `stats/hits` message

**Files:**
- Create: `src/shared/stats.js`, `src/background/stats.js`, `test/stats.test.js`
- Modify: `src/background/blocklist.js` (`handleMessage` signature), `src/background/index.js`, `test/blocklist.test.js`, `test/background.test.js`, `test/options.test.js` (each call to `handleMessage(msg, chrome.storage.sync)` becomes `handleMessage(msg, { sync: chrome.storage.sync, local: chrome.storage.local })`)

**Interfaces:**
- Produces, in `src/shared/stats.js`:
  - `export const STATS_PREFIX = "stats:"`
  - `export function statsKey(domain: string): string`
  - `export function parseStats(value: unknown): { blockedCount: number, lastBlockedAt: number | null } | null`. The value is valid only if `blockedCount` is a non-negative safe integer and `lastBlockedAt` is a finite number or `null`.
  - `export function statsFromItems(items: object): Map<string, Stats>`. It skips keys without the prefix and values that fail `parseStats`.
- Produces, in `src/background/stats.js`: `export async function recordHits(areas: { sync, local }, hits: unknown, now = Date.now()): Promise<{ ok: true, recorded: number } | { ok: false, reason: "error" }>`
- Changes: `handleMessage(msg, areas: { sync, local }, now)`. Existing cases pass `areas.sync` through. New case `"stats/hits"` with `msg.hits` calls `recordHits`.
- `src/background/index.js` passes `{ sync: chromeApi.storage.sync, local: chromeApi.storage.local }`.

- [ ] **Step 1: Write the failing tests** in `test/stats.test.js`:
  ```js
  test("parseStats accepts valid values and rejects the rest", () => {
    assert.deepEqual(parseStats({ blockedCount: 3, lastBlockedAt: 5 }), { blockedCount: 3, lastBlockedAt: 5 });
    assert.deepEqual(parseStats({ blockedCount: 0, lastBlockedAt: null }), { blockedCount: 0, lastBlockedAt: null });
    for (const bad of [null, 3, [], { blockedCount: -1, lastBlockedAt: null }, { blockedCount: 1.5, lastBlockedAt: null },
      { blockedCount: "3", lastBlockedAt: null }, { blockedCount: 1, lastBlockedAt: "x" }, { blockedCount: NaN, lastBlockedAt: 1 }])
      assert.equal(parseStats(bad), null);
  });
  test("recordHits adds to existing counts and sets lastBlockedAt", async () => {
    // sync has d:a.com and d:b.com; local has stats:a.com = { blockedCount: 2, lastBlockedAt: 1 }
    const res = await recordHits(areas, { "a.com": 3, "b.com": 1 }, 100);
    assert.deepEqual(res, { ok: true, recorded: 2 });
    assert.deepEqual(local["stats:a.com"], { blockedCount: 5, lastBlockedAt: 100 });
    assert.deepEqual(local["stats:b.com"], { blockedCount: 1, lastBlockedAt: 100 });
  });
  test("recordHits counts archived domains too", ...);           // d:a.com has s "x"; count lands
  test("recordHits drops hits for domains with no sync record", ...); // Review Focus 1: no stats:gone.com written
  test("recordHits skips invalid entries and keeps valid ones", ...);
  // { "a.com": 1, "WWW.A.com": 1, "reddit.com": 1, "b.com": -1, "c.com": 1.5, "d.com": "2", "e.com": 1e9 } -> only a.com recorded
  test("recordHits with a non-object hits writes nothing and is ok with recorded 0", ...); // null, [], "x"
  test("recordHits makes one local set() per call", ...);         // spy on local.set
  test("a malformed existing stats value is treated as zero", ...); // stats:a.com = "junk" -> becomes { blockedCount: 1, ... }
  test("a failed local write is reason error", ...);              // local.failNextSet(new Error("x"))
  ```
  Valid entries: the key is a domain string for which `normalizeInput(key)` returns `{ ok: true, domain: key }`, and the count is a safe integer from 1 to 10000. Add this to `test/background.test.js`:
  ```js
  test("concurrent stats/hits from two tabs both land", async () => { // Review Focus 3
    await Promise.all([fake.runtime.dispatchMessage({ type: "stats/hits", hits: { "a.com": 2 } }),
                       fake.runtime.dispatchMessage({ type: "stats/hits", hits: { "a.com": 3 } })]);
    assert.equal((await fake.storage.local.get("stats:a.com"))["stats:a.com"].blockedCount, 5);
  });
  ```
- [ ] **Step 2: Run** `node --test test/stats.test.js test/background.test.js` and expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/shared/stats.js` and `src/background/stats.js`. In `recordHits`, read the sync records and the local stats for the valid domains with one `get(keys)` each, then write every updated stat with one `local.set()`. Change the `handleMessage` signature and update the existing callers and tests listed under Files.
- [ ] **Step 4: Run** `npm test` and expect PASS for the whole suite.
- [ ] **Step 5: Commit** `feat: record per-domain hidden-post counts in local storage`.

---

### Task 2: Restore and Delete permanently messages

**Files:**
- Modify: `src/background/blocklist.js`, `src/options/view.js` (`messageFor`), `test/blocklist.test.js`, `test/options.test.js`

**Interfaces:**
- Consumes: `statsKey` (Task 1); `handleMessage(msg, areas, now)` (Task 1).
- Produces:
  - `export async function restoreDomain(area, domain: string, now = Date.now()): Promise<{ ok: true, domain, outcome: "restored" | "exists" } | { ok: false, domain, reason: "not-found" | "quota" | "error" }>`. The archived branch of `addDomain` reuses its write and keeps the record's original `source` and `addedAt`.
  - `export async function deleteDomain(areas: { sync, local }, domain: string): Promise<{ ok: true, domain, outcome: "deleted" } | { ok: false, domain, reason: "not-found" | "not-archived" | "error" }>`. It removes `d:<domain>` from sync first and then `stats:<domain>` from local.
  - New `handleMessage` cases: `"domain/restore"` with `msg.domain`, and `"domain/delete"` with `msg.domain`.
  - New `messageFor` cases: outcome `"deleted"` gives `{ kind: "status", text: "Deleted <domain> permanently" }`. Reason `"not-archived"` gives `{ kind: "error", text: "<domain> is blocked again, so it wasn't deleted." }`.

- [ ] **Step 1: Write the failing tests** in `test/blocklist.test.js`:
  ```js
  test("restore sets s a, drops x, bumps u, keeps c and o", ...);  // stored { s:"x", c:1, u:2, x:2, o:"m" } -> { s:"a", c:1, u:now, o:"m" }
  test("restoring an active domain is outcome exists and writes nothing", ...);
  test("restoring an unknown domain is not-found", ...);
  test("delete removes the sync record and the local stats", ...);
  test("delete refuses an active domain with not-archived and changes nothing", ...);
  test("delete of an unknown domain is not-found", ...);
  test("delete leaves other domains' records and stats alone", ...);
  test("handleMessage routes domain/restore and domain/delete", ...);
  ```
  Add assertions for the two new `messageFor` cases in `test/options.test.js`.
- [ ] **Step 2: Run** `node --test test/blocklist.test.js test/options.test.js` and expect FAIL.
- [ ] **Step 3: Implement** `restoreDomain`, `deleteDomain`, the two `handleMessage` cases, and the `messageFor` cases. The fake area's `remove()` already exists.
- [ ] **Step 4: Run** `npm test` and expect PASS.
- [ ] **Step 5: Commit** `feat: add restore and permanent delete to the service worker`.

---

### Task 3: Count hidden posts in the content script

**Files:**
- Create: `src/content/hits.js`, `test/hits.test.js`
- Modify: `src/content/blocker.js`, `src/content/index.js`, `test/blocker.test.js`, `test/content-index.test.js` (the fake `win` gains `setTimeout`/`clearTimeout` that record callbacks, so tests can fire them by hand)

**Interfaces:**
- Consumes: the `stats/hits` message (Task 1).
- Produces:
  - `createBlocker({ ..., onHit })`. `onHit(domain: string)` is optional (no-op default). It is called once per post per page load with the matching blocklist entry. Dedupe by post id, or by node for posts without an id, using the same id/node split as the revealed state.
  - `export function createHitBatcher({ send, delayMs = 500, timers }): { add(domain: string): void, flush(): void }`. `timers` provides `setTimeout`/`clearTimeout`. The first `add` of a batch starts one timer, and later adds don't reset it, so continuous scrolling still flushes every 500 ms. `flush` sends `{ type: "stats/hits", hits: { [domain]: count } }` once if the batch is non-empty and clears the timer. A rejected or throwing `send` is swallowed.
  - `init` in `src/content/index.js` wires `onHit` to a batcher with `send: (msg) => chrome.runtime.sendMessage(msg)` and `timers: window`, and flushes on `window` `pagehide`.

- [ ] **Step 1: Write the failing tests.** `test/hits.test.js`:
  ```js
  test("adds within the window become one message with summed counts", ...); // add a, a, b; fire timer -> one send { a: 2, b: 1 }
  test("the timer is not reset by later adds", ...);                         // exactly one setTimeout call per batch
  test("flush with nothing pending sends nothing", ...);
  test("a rejected send is swallowed and the next batch still sends", ...);
  test("a send that throws synchronously is swallowed", ...);
  ```
  `test/blocker.test.js`:
  ```js
  test("onHit fires once per matching post with the matching entry", ...);  // 2 matching + 1 non-matching -> ["a.com","a.com"]
  test("re-scans, Show/Hide post, and unblock-then-reblock do not count again", ...);
  test("a recycled node with a new post id counts the new post; back to the old id does not", ...);
  test("posts on a post page or search page are not counted", ...);
  ```
  `test/content-index.test.js`:
  ```js
  test("hidden posts produce one stats/hits message after the timer fires", ...); // message handler records msgs
  test("pagehide flushes pending hits", ...);
  ```
- [ ] **Step 2: Run** `node --test test/hits.test.js test/blocker.test.js test/content-index.test.js` and expect FAIL.
- [ ] **Step 3: Implement** `createHitBatcher`, the blocker's counted-set (in `evaluate`, once a domain matches), and the wiring in `init`.
- [ ] **Step 4: Run** `npm test` and expect PASS.
- [ ] **Step 5: Commit** `feat: count hidden posts and batch counts to the service worker`.

---

### Task 4: Options page counts, Archived section, and Restore

**Files:**
- Modify: `extension/options.html`, `extension/options.css`, `src/options/view.js`, `src/options/index.js`, `test/options.test.js`

**Interfaces:**
- Consumes: `statsFromItems` (Task 1); `domain/restore` and `messageFor` (Task 2).
- Produces:
  - `options.html` sections: `<section aria-labelledby="active-heading"><h2 id="active-heading">Blocked domains</h2><div id="list"></div></section>` and `<section aria-labelledby="archived-heading"><h2 id="archived-heading" tabindex="-1">Archived</h2><div id="archived-list"></div></section>`, after the live regions.
  - `renderList(root, records, stats: Map, handlers: { onRemove })`. Columns: Domain, **Posts hidden** (`th scope="col"`), and visually hidden "Actions". The count cell is `<td class="count" data-count-for="<domain>">`.
  - `renderArchived(root, records, stats: Map, handlers: { onRestore, onDelete, onConfirm, onCancel }, confirming: string | null)`. It renders a table with caption "Archived domains" and columns Domain, **Archived** (`<time datetime="<ISO>">` with `toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })`), **Posts hidden**, and Actions, sorted by domain. When there are no archived records it renders `<p class="empty">No archived domains.</p>`.
  - `export function updateCounts(doc, stats: Map): void`. It sets each `[data-count-for]` cell's text to its count, or `0` when there is no count, without touching anything else.
  - Every row button carries `data-domain` and `data-action` (`remove`, `restore`, `delete`, `confirm`, or `cancel`). The Restore button has the arrow-back-up icon, the text "Restore", `aria-label="Restore <domain>"`, `title="Block <domain> again"`, and grey styling. The Delete button is Task 5's, rendered here as `data-action="delete"`.
  - In `index.js`, focus is generalized from `.btn-remove` to the pair (domain, action). After any render, focus goes back to the button with the same pair. If that row is gone, it falls back to the same action in the next row, then the previous row, then a default: the input for `remove`, `#archived-heading` for `restore`, `delete`, `confirm`, and `cancel`. Focus outside the tables is never moved.
  - `refresh()` reads `sync.get(null)` and `local.get(null)` under the existing sequence token. `onChanged`: a `sync` change calls `refresh()`. A `local` change whose keys include a `stats:` key re-reads local and calls `updateCounts` only. That replaces the M1 test "changes in other storage areas do not trigger a render".
  - `EMPTY_TEXT` is unchanged until Task 6.

- [ ] **Step 1: Write the failing tests** in `test/options.test.js`:
  ```js
  test("active table shows Posts hidden from local stats, 0 when missing", ...);
  test("archived table: caption, th scope=col, time datetime, counts, Restore button names", ...);
  test("no archived records shows 'No archived domains.' and keeps the Archived heading", ...);
  test("page shell has h1 then two h2s, Archived heading is focusable with tabindex -1", ...);
  test("Restore sends domain/restore, announces Restored, row moves to the active table", ...);
  test("after Restore focus goes to the next archived Restore, else previous, else the Archived heading", ...);
  test("a stats change updates count cells in place: same table nodes, focus unchanged", ...); // keep a ref to the <table>, assert ===
  test("a local change with no stats: keys does nothing", ...);
  test("a malformed stats value shows 0 and does not throw", ...); // Review Focus 5
  ```
- [ ] **Step 2: Run** `node --test test/options.test.js` and expect FAIL.
- [ ] **Step 3: Implement** the HTML, view functions, focus generalization, and refresh changes. In CSS, `td.count` is right-aligned with `font-variant-numeric: tabular-nums`. Add an `.btn-secondary` class only if needed, since `.btn` is already grey outlined. Add `h2` styling and `margin-top` for the second section.
- [ ] **Step 4: Run** `npm test` and expect PASS. Run `npm run build` and expect it to exit 0.
- [ ] **Step 5: Commit** `feat: show counts and an Archived section with Restore on the options page`.

---

### Task 5: Two-step Delete permanently

**Files:**
- Modify: `scripts/gen-icons.js` (add `"x"` to `names`), `src/shared/icons.js` (regenerated), `test/icons.test.js` (add `"x"`), `src/options/view.js`, `src/options/index.js`, `extension/options.css`, `test/options.test.js`

**Interfaces:**
- Consumes: `renderArchived(..., confirming)`, the (domain, action) focus logic (Task 4), and `domain/delete` (Task 2).
- Produces:
  - In a row that isn't confirming, the Delete button has the trash icon, the text "Delete permanently", `aria-label="Delete permanently: <domain>"`, `title="Delete <domain> and its history"`, and red styling.
  - A row where `confirming === domain` replaces Delete with `<span role="group" aria-label="Confirm deleting <domain>">`. It holds the visible text "Really delete?", a red **Confirm** (trash icon, `aria-label="Confirm delete of <domain>"`, `title="Delete <domain> permanently"`), and a grey **Cancel** (x icon, `aria-label="Cancel delete of <domain>"`, `title="Keep <domain>"`). Restore stays in place.
  - `index.js` holds `confirming: string | null`, and every render passes it. A Delete click sets it and focuses Confirm. Cancel, or Escape on either group button, clears it and focuses that row's Delete. A Confirm click sends `domain/delete`. On `ok` it clears `confirming`, announces the result, refreshes, and moves focus as in Global Constraints. On failure it clears `confirming`, shows the error in `role="alert"`, and focuses Delete. If a render finds that the `confirming` domain is no longer archived, `confirming` is cleared.

- [ ] **Step 1: Write the failing tests** in `test/options.test.js` (and the `x` case in `test/icons.test.js`):
  ```js
  test("first Delete click shows the confirm group, writes nothing, focuses Confirm", ...); // acceptance 6
  test("Confirm deletes: record and stats gone, 'Deleted x permanently' in role=status", ...);
  test("Cancel and Escape restore the Delete button and focus it; nothing written", ...);
  test("after a confirmed delete focus goes to the next row's Restore, else previous, else the Archived heading", ...);
  test("only one row confirms at a time: Delete on row B closes row A's confirm", ...);
  test("an open confirmation survives a stats update and an unrelated sync change", ...); // Review Focus 2
  test("a confirming domain restored elsewhere closes the confirmation without throwing", ...);
  test("a failed delete shows role=alert and returns focus to Delete", ...);
  test("no window.confirm is called", ...); // stub dom.window.confirm to throw
  ```
- [ ] **Step 2: Run** `node --test test/options.test.js test/icons.test.js` and expect FAIL.
- [ ] **Step 3: Implement.** Run `npm run gen-icons` after editing `names`. Lay the confirm group out inline with `flex-wrap: wrap` so it doesn't overflow at narrow widths.
- [ ] **Step 4: Run** `npm test` and expect PASS.
- [ ] **Step 5: Commit** `feat: add two-step Delete permanently to the Archived section`.

---

### Task 6: Right-click menu in the service worker

**Files:**
- Create: `src/background/menu.js`, `test/menu.test.js`
- Modify: `extension/manifest.json`, `test/manifest.test.js`, `src/background/index.js`, `test/background.test.js`, `test/helpers/fake-chrome.js`, `src/options/view.js` (`EMPTY_TEXT`)

**Interfaces:**
- Consumes: `addDomain(area, input, "context-menu", now)` from M1.
- Produces:
  - `export const MENU_ID = "block-domain"`
  - `export async function registerMenu(contextMenus): Promise<void>`. It calls `removeAll()` and then `create({ id: MENU_ID, title: "Block this domain", contexts: ["link"], documentUrlPatterns: ["*://*.reddit.com/*"] })`.
  - `export function menuNoticeFor(result): { kind: "status" | "error", text: string } | null`. It returns `null` for outcomes `added` and `restored`, where the hiding is the confirmation. It returns `{ kind: "status", text: "<domain> is already blocked." }` for `exists`. For the error reasons it returns these texts:
    - `protected`: "Reddit's own links can't be blocked. Right-click the post's outbound link instead."
    - `protected` when the link is on an ad host (`alb.reddit.com`): "This looks like an ad. Ads can't be blocked by domain." `menuNoticeFor(result, linkUrl)` takes the link as a second argument for this.
    - `invalid` / `empty` / `single-label`: "That link has no domain that can be blocked."
    - `ip`: "IP addresses can't be blocked."
    - `quota`: "The block list is full. Remove some domains on the options page."
    - anything else: "Couldn't block that domain. Please try again."
  - In `index.js`, `runtime.onInstalled` calls `registerMenu`. `contextMenus.onClicked` is registered at the top level of `init`, so a sleeping worker still receives it. For `info.menuItemId === MENU_ID`, it enqueues `addDomain(areas.sync, info.linkUrl, "context-menu")` on the existing queue. If `menuNoticeFor` returns a notice and `tab?.id >= 0`, it calls `chromeApi.tabs.sendMessage(tab.id, { type: "notice", kind, text })` and swallows any rejection. The listener returns that promise for tests.
  - Fake chrome additions: `contextMenus.create(props)` pushes to `fake.contextMenus.items`. `contextMenus.removeAll()` clears the list. `contextMenus.onClicked.addListener(fn)`. `fake.contextMenus.click(info, tab)` returns `Promise.all` of the listener return values. `runtime.onInstalled.addListener(fn)` with `fake.runtime.install()`. `tabs.sendMessage(tabId, msg)` records into `fake.tabs.sent`, and `fake.tabs.failNextSend(err)` makes the next call reject.
  - Manifest `permissions: ["storage", "contextMenus"]`.
  - `EMPTY_TEXT = "No blocked domains yet. Paste one above, or right-click an outgoing link on Reddit and choose Block this domain."`

- [ ] **Step 1: Write the failing tests.** In `test/manifest.test.js`, change the permissions assertion to `["storage", "contextMenus"]`. `test/menu.test.js`:
  ```js
  test("registerMenu creates exactly one entry with the spec's properties", ...); // calling twice still leaves one
  test("menuNoticeFor: null for added and restored; texts for exists and every reason", ...);
  ```
  `test/background.test.js`:
  ```js
  test("install registers the menu", ...);
  test("clicking on an outbound link adds the domain with source context-menu and sends no notice", ...);
  // linkUrl "https://www.thedailybeast.com/x?y=1" -> d:thedailybeast.com with o "m"; fake.tabs.sent empty
  test("an archived domain is restored, not duplicated", ...);
  test("Reddit permalink, user link, and mailto: are refused with a notice; nothing written", ...); // Review Focus 4
  // https://www.reddit.com/r/news/comments/abc/x/, https://www.reddit.com/user/someone, mailto:a@b.com
  test("an already active domain sends the 'already blocked' notice", ...);
  test("a rejected tabs.sendMessage is swallowed", ...);       // Review Focus 4
  test("a click with no tab or another menu id does nothing", ...);
  test("a menu click and a message are serialized on one queue", ...);
  ```
- [ ] **Step 2: Run** `node --test test/menu.test.js test/background.test.js test/manifest.test.js` and expect FAIL.
- [ ] **Step 3: Implement** `menu.js`, the `index.js` wiring, the fake chrome additions, the manifest change, and the new `EMPTY_TEXT`. Update the options test that asserts on the empty text.
- [ ] **Step 4: Run** `npm test` and expect PASS. Run `npm run build` and expect it to exit 0.
- [ ] **Step 5: Commit** `feat: add the Block this domain right-click menu`.

---

### Task 7: In-page notice for refused right-clicks

**Files:**
- Create: `src/content/notice.js`, `test/notice.test.js`
- Modify: `src/content/index.js`, `test/content-index.test.js`

**Interfaces:**
- Consumes: the `{ type: "notice", kind, text }` message (Task 6), `detectTheme(document)` from `src/content/theme.js`, and `icon("x")` (Task 5).
- Produces:
  - `export function createNotice(document): { show({ kind: "status" | "error", text: string }): void, dismiss(): void }`. On first `show`, it appends one host element `<div data-rdb-notice>` to `document.body` (or `documentElement`) with an open shadow root. The root holds a `role="status"` region, a `role="alert"` region, and a grey **Dismiss** button (x icon, text "Dismiss", `aria-label="Dismiss message"`, `title="Dismiss message"`). `show` writes the text into the region that matches `kind`, empties the other, and makes the host visible with the theme from `detectTheme(document)` at that moment. A second `show` replaces the text. Focus never moves. The Dismiss button, or Escape while focus is inside the notice, hides it. There is no timeout. Position is fixed at the bottom center, with a z-index above Reddit's header and colors taken from the stub's palette (contrast as in 6.1).
  - `init` adds `chrome.runtime.onMessage.addListener(msg => ...)`. It handles only `msg?.type === "notice"` where `kind` is `"status"` or `"error"` and `text` is a non-empty string, which it truncates to 300 characters. Anything else is ignored, and the listener never throws. Notices work on every Reddit page, including post and search pages.

- [ ] **Step 1: Write the failing tests.** `test/notice.test.js`:
  ```js
  test("error goes to role=alert, status to role=status, the other region is emptied", ...);
  test("one host for any number of shows; the second show replaces the text", ...);
  test("Dismiss hides it; Escape inside hides it; Escape outside does nothing", ...);
  test("show does not move focus", ...);
  test("theme follows Reddit's theme at show time", ...); // html class theme-dark -> dark
  test("text is set as text, not HTML", ...); // "<b>x</b>" shows literally
  ```
  `test/content-index.test.js`:
  ```js
  test("a notice message shows the notice; malformed notice messages are ignored", ...);
  ```
  The fake chrome needs a way to deliver a runtime message to content listeners. `fake.runtime.dispatchMessage` already does this.
- [ ] **Step 2: Run** `node --test test/notice.test.js test/content-index.test.js` and expect FAIL.
- [ ] **Step 3: Implement** `notice.js` and the listener in `init`.
- [ ] **Step 4: Run** `npm test` and expect PASS. Run `npm run build` and expect it to exit 0.
- [ ] **Step 5: Commit** `feat: explain refused right-clicks with an in-page notice`.

---

### Task 8: Live verification and docs

The automation browser can't open reddit.com or `chrome://extensions` (see `NOTES.md`, M1 verification), so the owner runs these checks and reports the results.

**Files:**
- Modify: `NOTES.md` (add `## M2 verification`), `README.md` (status line)

- [x] **Step 1: Build and hand off.** Run `npm test && npm run build` and expect all tests to pass and the build to exit 0. Ask the owner to reload the unpacked extension and then run each check below on new and old Reddit, reporting pass or fail:
  1. Right-click an outbound post link and choose **Block this domain**. Matching posts hide in every open Reddit tab, and the options page (open in another tab) lists the domain without a reload.
  2. Right-click a post's comments link or a username. A notice explains the refusal, and nothing is added.
  3. Paste `https://www.example.com:8080/a/b?c=d#e` on the options page. It saves `example.com`. Adding `reddit.com` is refused with an explanation (acceptance 8).
  4. Scroll a feed with a blocked domain. The options page's **Posts hidden** count rises within about a second, and scrolling back up doesn't add to it. A reload counts the same posts again.
  5. Remove a domain. It moves to Archived with today's date and keeps its count. **Restore** moves it back with the count intact.
  6. **Delete permanently** shows "Really delete?". Only Confirm deletes, and Cancel and Escape back out (acceptance 6). After the delete, re-adding the domain starts its count at 0.
  7. Keyboard only: Restore, Delete → Confirm, Delete → Escape, and Dismiss on the notice all work, and focus lands where Global Constraints says.
  8. Console: nothing from `content.js`, and the service worker's console (from `chrome://extensions`) shows no errors.
- [x] **Step 2: Record** the results in `NOTES.md` under `## M2 verification`, using the same table form as M1. Fix any failure before moving on, with a new task-sized commit for each.
- [x] **Step 3: Update** `README.md` to say M2 is implemented and checked by hand, with import/export and polish still to come (M3 onward).
- [x] **Step 4: Commit** `docs: record M2 verification`.

# Reddit Domain Blocker — Spec

A Manifest V3 Chrome extension that hides Reddit posts by the domain of the link they point to.

Items marked **(call)** are decisions made by the spec author, not stated by the owner. Everything else was decided by the owner.

## Contents

1. [Intent](#1-intent)
2. [Platform and constraints](#2-platform-and-constraints)
3. [Data model](#3-data-model)
4. [Behavior](#4-behavior)
5. [Options page](#5-options-page)
6. [Accessibility](#6-accessibility)
7. [Edge cases to handle](#7-edge-cases-to-handle)
8. [Left to the builder](#8-left-to-the-builder)
9. [Acceptance](#9-acceptance-what-done-looks-like)
10. [Build order and milestones](#10-build-order-and-milestones)

## 1. Intent

The owner's Reddit feed is flooded with clickbait from a handful of outlets (the trigger case is `thedailybeast.com`: headlines like "Fox viewers slam so-and-so" that are really a few comments on a tweet). They don't want to leave Reddit or mute whole subreddits. They want to name a domain once and never see its posts again, while keeping a visible trace that something was hidden (so they know the extension is working, and can peek if curious).

### Goals
- Hide any post whose link domain, or a parent of that domain, is on the blocklist.
- Leave a visible stub in place of each hidden post, with controls to reveal it or unblock the domain.
- Manage the list from an options page and from a right-click menu on Reddit links.
- Changes apply immediately in every open Reddit tab.
- Work on old.reddit.com and new Reddit.
- Per-domain history (dates, counts), archive instead of delete, and JSON import/export.

### Non-goals
- Browsers other than Chrome (and Chromium browsers that run MV3 extensions as-is). No Firefox/Safari packaging.
- Blocking by subreddit, user, keyword, flair, or regex/wildcard. Domains only.
- Hiding comments, or links inside comments.
- The Reddit mobile app and m.reddit.com.
- Any network request made by the extension. No analytics, no remote code, no CDN assets.

### Anti-goals (a failure even if it technically works)
- Breaking Reddit's layout, scrolling, or infinite scroll.
- Hiding a post the user did not block (false positives, e.g. matching `notexample.com` for `example.com`).
- Visible flash of blocked posts before they get hidden, on first load or while scrolling. Minimize it.
- Blocking Reddit's own domains (see 4.3).

[↑ Back to contents](#contents)

## 2. Platform and constraints

- Manifest V3. Background logic in a service worker (no persistent background page).
- Permissions: `storage`, `contextMenus`. Content scripts matched to `*://*.reddit.com/*`. No broad host permissions, no `tabs`, no `activeTab`.
- All code and assets (including icons) bundled locally. MV3 forbids remotely hosted code.
- `minimum_chrome_version`: 120 **(call)**.
- **License: MIT.** The project root has a `LICENSE` file with the MIT text (already created; copyright holder "Narciso Lobo", 2026). Bundled Tabler Icons are also MIT and require their copyright notice and license text to ship with the extension: include them in a `THIRD_PARTY_LICENSES` file (or similar) in the project root and in the packaged extension. Any other bundled third-party code gets the same treatment. Add `"author"` and `"license": "MIT"` to `package.json` if the builder uses one **(call)**.
- No build step is required; plain JS/HTML/CSS is fine. Choice of tooling is left to the builder.
- Toolbar action: clicking opens the options page **(call)**.

[↑ Back to contents](#contents)

## 3. Data model

### 3.1 Sync storage (`chrome.storage.sync`): the blocklist
One storage item per domain, key `d:<hostname>`, value in a compact stored form **(call)**:

```json
{ "s": "a" | "x",          // status: active | archived
  "c": 1793297667000,      // addedAt, epoch ms
  "u": 1793297667000,      // updatedAt, epoch ms
  "x": 1793297667000,      // archivedAt, epoch ms; omitted while active
  "o": "o" | "m" | "s" | "i" }  // source: options | context-menu | stub | import
```

The rest of this spec uses the readable names (`status`, `addedAt`, `updatedAt`, `archivedAt`, `source`); the compact keys and epoch-ms times are only the stored form, and the export file (5.4) uses the readable form with ISO-8601 dates. The builder may adjust the compact encoding as long as it stays about this small.

Why per-domain items with a compact form: sync caps each item at 8 KB, total items at 512, and total size at about 100 KB, where each item counts its key plus its serialized value. At roughly 100 bytes per record the 512-item cap binds first, so the list holds about 500 domains, active plus archived. With the verbose ISO-string form (about 200 bytes per record) the byte cap would bind first at roughly 400 to 480, hence the compact form. When a write fails on quota, show a clear message on the options page (never fail silently) **(call)**. Bulk writes (import) must be a single `set()` with many keys because sync also rate-limits write operations.

`updatedAt` changes on any change to the record (restore, archive, re-add, import merge).

### 3.2 Local storage (`chrome.storage.local`): stats
Key `stats:<hostname>` → `{ "blockedCount": number, "lastBlockedAt": epoch ms | null }` (ISO-8601 in the export file).

Stats are local because they change often and sync rate-limits writes. They do not roam between devices. Counts are keyed by domain, independent of status, and survive archive/restore. Content scripts batch their increments with a short debounce (about 500 ms), so a large infinite-scroll batch becomes one message and one write, not dozens **(call)**. The service worker receives these messages and serializes writes so that two tabs do not overwrite each other's increments **(call)**.

### 3.2a Write path and conflicts **(call)**
The service worker is the only writer to both storage areas. The options page, the stub's Unblock button, and the context menu send it messages; content scripts only read and listen. Across devices, sync is last-write-wins per domain key; no merge logic beyond that. Quota failures (item count or size) on any write path are reported back to the caller, which tells the user; the stub and menu may use any lightweight mechanism for this.

### 3.3 Count semantics
`blockedCount` increments the first time a given post is hidden within a page load (dedupe by post id/fullname, in memory per tab). New Reddit recycles elements while scrolling, so do not count element re-hides. A reload counts the post again; that inaccuracy is accepted **(call)**.

Likewise, "revealed" state is tracked per page load in a map keyed by post fullname, not on the DOM node, so it survives element recycling and back/forward navigation within the page load, and resets on reload **(call)**.

[↑ Back to contents](#contents)

## 4. Behavior

### 4.1 Matching
A post is blocked when the hostname of its outbound link equals an **active** domain `d`, or ends with `"." + d`. So `example.com` blocks `news.example.com` but not `notexample.com`. Hostnames compare lowercase. Archived domains do not block.

Posts with no outbound link (self/text posts, galleries, and image/video uploads hosted on Reddit's own domains) are never hidden.

Link source:
- **New Reddit:** the `content-href` attribute on `shreddit-post`.
- **Old Reddit:** the `data-url` attribute on the post's `.thing` element (not `data-domain`, which is `self.<subreddit>` for text posts and can be misleading for others).

Cross-posts: if the DOM exposes the original post's outbound link, match on that. If the attribute only holds a Reddit permalink, treat it as no outbound link and accept that such cross-posts are not hidden in v1 **(call)**.

Selectors and attribute names are the builder's to verify against live pages; they can change.

### 4.2 Where it runs
Feed (home, popular, all), subreddit pages, and user profile post listings, on both old and new Reddit. **Search results are deliberately left alone**: someone searching for a topic should see every result, including blocked domains. **It does not run on a post's own page** (URL path contains `/comments/<id>`): nothing is hidden there, including related-post lists on that page **(call)**.

Posts that appear later (infinite scroll, "load more", client-side navigation on new Reddit) are handled with a `MutationObserver`. Navigating between a listing and a post page on new Reddit (single-page app, no reload) must switch the behavior correctly in both directions. The rule keys off the current URL only: while the URL is a `/comments/` path (including when new Reddit shows a post in an overlay above a listing), the extension neither hides new posts nor restores existing stubs; when the URL returns to a listing, it rescans **(call)**.

**Flash tolerance:** "reasonable", not zero **(call)**. Run the content script at `document_start`, read the blocklist immediately (content scripts read `chrome.storage.sync` from Chrome's local cache, so mirroring the list elsewhere will not make this meaningfully faster), start the observer right away, and hide matching posts as they enter the DOM, adding the stub right after.

Measure before adding more: on live new and old Reddit, record whether blocked posts visibly paint before they are hidden, on cold load and on infinite scroll. Only if they do, add a pre-paint step: a stylesheet built from the cached list that hides probable matches (for example with attribute-suffix selectors on the link attribute) until the script confirms or corrects them, accepting a brief false-positive hide that the script then undoes **(call)**. Do not add this speculatively.

### 4.3 Protected domains
`reddit.com`, `redd.it`, `redditmedia.com`, `redditstatic.com` and their subdomains can never be blocked, from any entry point (options page, context menu, import). Attempts show a short explanation, not a silent no-op **(call)**.

### 4.4 The stub
A blocked post is **hidden in place, never removed**, and a stub is inserted as its sibling. Reddit's own code manages these nodes (new Reddit recycles them during infinite scroll), so the extension must not remove, move, or replace them. Hide with an injected stylesheet rule (a class or attribute set on the post, styled `display: none !important`), because Reddit's CSS can override a plain `hidden` attribute. Restoring means removing the class and the stub. The stub is a compact dashed-border bar with:
- Icon + text `Hidden: <domain>`. The domain text may truncate with an ellipsis on narrow widths. `<domain>` is the matching blocklist entry (e.g. `example.com`), not the post's full hostname **(call)**.
- **Show post** button: reveals that post for the rest of the page load (a reload hides it again). The observer must not re-hide a revealed post. When revealed, the post offers a way to collapse it back to the stub **(call)**.
- **Unblock domain** button: archives the domain (see 4.6). All stubs for that domain in every open tab turn back into normal posts.

Implementation requirements:
- The stub is isolated from Reddit's CSS (for example a shadow-DOM host), and Reddit's CSS must not be able to restyle it.
- Its light/dark appearance **matches the theme Reddit is currently showing**, not the OS setting, and updates if the user switches Reddit's theme. How to detect that is left to the builder; verify on both old and new Reddit.
- The stub is keyboard accessible (real buttons, visible focus) and has sensible accessible names.

### 4.5 Live updates
Content scripts listen to `chrome.storage.onChanged` (sync area for the list) and re-evaluate the whole page: newly blocked domains hide matching posts, unblocked/archived domains restore them, restored domains hide again (clearing any "revealed" state for them).

### 4.6 Archive, not delete
- **Remove** (options page) and **Unblock domain** (stub) set `status: "archived"` and `archivedAt`. The domain stops blocking immediately. History and stats are kept.
- Adding a domain that exists as archived **restores** it (status active, `archivedAt` null, `updatedAt` now), not a duplicate. Adding one that is already active does nothing and says so.
- **Delete permanently** exists only in the Archived section and is **two-step**: first click turns the button into an inline confirmation (for example "Really delete? Confirm / Cancel"); only the confirm click deletes. Do not use `window.confirm`. Deleting removes both the sync record and the local stats for that domain.

### 4.7 Right-click menu
A `contextMenus` entry titled **Block this domain**, shown only for `contexts: ["link"]` and only on Reddit pages (`documentUrlPatterns` for reddit.com). The domain comes from the clicked link's URL (`info.linkUrl`), normalized as in 5.1. Result: the domain is added (or restored), `source: "context-menu"`, and the open tabs update through 4.5. The hiding itself is the confirmation. If the link is a protected domain or unparseable, tell the user why (mechanism is the builder's call).

Reddit's own wrapper links (internal comment/permalink URLs) are protected domains and will be refused with an explanation. The menu entry's appearance (color/icon) is controlled by Chrome and not styleable.

[↑ Back to contents](#contents)

## 5. Options page

### 5.1 Adding domains
One text box + **Add** button (Enter also submits). Pasted input is normalized to a bare hostname:
- trim whitespace; accept input with or without scheme;
- take the hostname only: drop scheme, credentials, port, path, query, fragment, trailing dot;
- lowercase; convert IDNs to punycode via `URL` parsing;
- strip a leading `www.` **(call)** (subdomain matching makes it redundant);
- reject input with no resolvable hostname, IP addresses, or single-label hosts like `localhost` **(call)**; no Public Suffix List is bundled, so `co.uk` style entries are not rejected by the extension (accepted limitation **(call)**);
- reject protected domains (4.3);
- duplicates handled per 4.6.

Show what was actually saved (e.g. pasted `https://www.thedailybeast.com/x?y=1` → "Added thedailybeast.com").

### 5.2 Active list
Table of active domains: **Domain**, **Posts hidden** (count from local stats), **Remove** button (archives). Generous vertical spacing between rows (owner explicitly asked); rows read as separate cards/bands. An empty state explains how to add a domain and mentions the right-click menu.

### 5.3 Archived section
Table of archived domains: Domain, archived date, posts hidden, **Restore**, **Delete permanently** (two-step, 4.6). Hidden/collapsed by default is fine when empty.

### 5.4 Export
Button **Export list** downloads a JSON file (including archived records). Shape:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-10-29T14:03:00Z",
  "extensionVersion": "1.0.0",
  "domains": [
    {
      "domain": "thedailybeast.com",
      "status": "active",
      "addedAt": "2026-10-29T12:00:00Z",
      "updatedAt": "2026-10-29T12:00:00Z",
      "archivedAt": null,
      "blockedCount": 142,
      "lastBlockedAt": "2026-10-29T13:55:00Z",
      "source": "context-menu"
    }
  ]
}
```

### 5.5 Import
Button **Import list…** opens a file picker for the format above. Validate before writing anything: valid JSON, supported `schemaVersion`, each domain normalizes per 5.1 and is not protected. Unreadable files are rejected with a message and change nothing; individual invalid records are skipped and reported (count + reasons).

Before committing, show a small summary (N new, N merged, N skipped) and ask how to treat counts for domains that exist in both the file and the current list: **Use the larger count** or **Add the two counts together**. Default is "larger" **(call)**, since re-importing your own export would double-count under "sum".

Merge rules for a domain present on both sides:
- `addedAt`: earliest. `updatedAt`: latest. `blockedCount`: per the chosen option. `lastBlockedAt`: latest.
- `status` and `archivedAt`: take the record with the later `updatedAt` **(call)**.
- `source`: keep the existing record's.

Domains only in the file are added with their stated status and metadata. Imported records are written to sync in one `set()` and to local stats in one `set()`.

Import is all-or-nothing **(call)**: before writing, check that the result stays within the sync limits (3.1), both item count (512) and total bytes (about 100 KB; estimate the size of the new and changed records plus `chrome.storage.sync.getBytesInUse()`, leaving a safety margin). If it would not fit, refuse the whole import with a message saying by how much, and change nothing.

### 5.6 Visual design
- Follows the system light/dark preference (`prefers-color-scheme`), no manual toggle.
- System-native sans stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Icons are **Tabler Icons** (MIT), bundled as local inline SVG. Only the few needed: plus (Add), trash (Remove), upload/download (Import/Export), eye (Show post), ban (hidden marker), arrow-back-up (Unblock/Restore).
- **Button styles** (every button has an icon plus a text label). Only three styles, to keep the palette small:
  - *Primary, green:* **Add**.
  - *Destructive, red:* **Remove** and **Delete permanently** (including its inline confirm step).
  - *Secondary, grey outlined* (transparent fill, grey border and text): **Import list**, **Export list**, **Restore**, and the stub's **Show post** and **Unblock domain**.

  Exact shades are the builder's, but they must pass contrast in both light and dark, and in the stub they must work against both of Reddit's themes.
- **Tooltips:** every button has a tooltip naming its action (for example, "Archive this domain", "Show this post once", "Unblock thedailybeast.com"). Use the native `title` attribute plus `aria-label`, or a custom tooltip that also appears on keyboard focus and meets WCAG 1.4.13 (see 6.4) **(call)**. This includes the stub's buttons, inside its isolated DOM.
- **Small viewports (412px wide and narrower):** button text is hidden and only the icon shows, on the options page and in the stub. Icon-only buttons keep their accessible name (`aria-label`) and tooltip, and a touch target of at least 44×44px **(call)**. Use a CSS media query (`max-width: 412px`); in the stub, make sure the query works inside its isolated DOM.
- The options page also reflects changes made elsewhere (for example a domain added via right-click while the page is open) without a reload.

[↑ Back to contents](#contents)

## 6. Accessibility

**Target: WCAG 2.2 Level AA**, for the options page and for everything the extension injects into Reddit (the stub). The extension cannot fix Reddit's own accessibility, but it must not make it worse. Success criteria numbers below are for the builder's reference; the list is the minimum, not a substitute for the standard.

### 6.1 Color and contrast
- Text and icons that convey meaning: at least 4.5:1 against their background (3:1 for large text). Component boundaries, icons used alone (icon-only buttons at small viewports), and focus indicators: at least 3:1 (1.4.3, 1.4.11). This includes the grey outlined buttons' border and text.
- Verified in light and dark on the options page, and in both of Reddit's themes for the stub (the stub cannot assume a background; see 4.4).
- Color is never the only signal (1.4.1): every button has an icon and a label (or accessible name), and status is stated in text, not just hue. Red and green are not the sole difference between Remove and Add.
- Support forced-colors / Windows High Contrast (`@media (forced-colors: active)`): buttons, borders, and focus rings stay visible using system colors **(call)**.

### 6.2 Keyboard and focus
- Everything works with the keyboard alone (2.1.1), with no traps (2.1.2): add a domain, remove, restore, two-step delete, import, export, and every stub button.
- Visible focus indicator on every interactive element (2.4.7), at least 3:1 contrast and not clipped by overflow. Focus is never hidden behind Reddit's sticky header or other overlays (2.4.11): scroll the focused control into view with enough margin.
- Tab order follows visual order. Use native `<button>`, `<input>`, `<table>`; no `div` buttons. Enter submits the Add form.
- Two-step delete: the first activation moves focus to the Confirm button; Escape or Cancel returns focus to the original Delete button; after a confirmed delete, focus moves to the next row's first control, or to the section heading if none remain **(call)**.
- Focus management in the stub: when a post is hidden or restored by a live update and it held focus, move focus to the stub (or restored post); never leave focus on a removed element. Show post moves focus to the revealed post's collapse control; collapsing returns focus to Show post **(call)**.

### 6.3 Names, roles, and screen readers
- Every control has an accessible name that includes its visible label (2.5.3); icon-only buttons (small viewports) use `aria-label` with the same wording as the tooltip. Same action, same icon, same name everywhere (3.2.4).
- The domain input has a visible `<label>` (3.3.2). The options page has a descriptive `<title>`, `lang` on the document, one `<h1>`, a logical heading order, and a `<main>` landmark (2.4.2, 1.3.1).
- Tables have a caption or accessible name, `<th scope>` headers, and the count column's header explains the number ("Posts hidden"). Icons that are purely decorative are `aria-hidden`.
- Status messages are announced without stealing focus (4.1.3): use `role="status"` for confirmations (domain added, restored, archived, import summary) and `role="alert"` for errors (invalid input, protected domain, quota exceeded, rejected import file).
- Input errors appear as text next to the field, tied to it with `aria-describedby` and `aria-invalid`, and say how to fix the problem (3.3.1, 3.3.3).
- On Reddit, a hidden post is removed from the accessibility tree and from the tab order (the `display: none !important` rule from 4.4, not just visual clipping) so screen readers hear only the stub. The stub is a labelled region/group, e.g. "Hidden post from thedailybeast.com". Do not announce each stub as it appears during infinite scroll (that would be noise) **(call)**.
- The shadow-DOM stub exposes its names and roles like any other markup; verify with a screen reader, not only the accessibility tree.

### 6.4 Targets, reflow, and text
- Targets at least 24×24 CSS px (2.5.8 minimum). This spec asks for 44×44 on icon-only buttons (5.6) as a stronger default **(call)**.
- Options page reflows at 320 CSS px width with no horizontal scrolling (1.4.10); at that width the tables become stacked rows/cards rather than scrolling sideways **(call)**.
- Usable at 200% text zoom, and when users override text spacing (1.4.4, 1.4.12). Use relative units; nothing clips or overlaps. Truncated domain text in the stub keeps its full text available (tooltip and accessible name).
- Honor `prefers-reduced-motion`: any transitions are removed or minimal. No animation is required anywhere.
- Tooltips (5.6) that are custom must satisfy 1.4.13: dismissible with Escape, hoverable, and persistent until dismissed. Native `title` alone does not appear on keyboard focus, so it never replaces the `aria-label`.

### 6.5 Verification
Before release: an automated pass (axe or Lighthouse) on the options page and on the stub as rendered on Reddit; a manual keyboard-only run of every flow in section 9; a screen-reader run on at least VoiceOver (macOS) and one of NVDA/JAWS; a contrast check in light and dark on both Reddit themes; and a 320px / 200%-zoom check. Automated tools do not prove AA, so the manual runs are required **(call)**.

[↑ Back to contents](#contents)

## 7. Edge cases to handle
- Link with an unparseable URL or a relative URL: treat as no outbound link (never hide).
- Many posts added at once (big infinite-scroll batch): process efficiently; don't re-scan the whole document on every mutation.
- A tab opened before the extension was installed/updated: no requirement beyond "works after reload".
- Service worker asleep when a context-menu click or stats message arrives: must still work (MV3 wakes it).
- Sync unavailable or signed out of Chrome: `chrome.storage.sync` still works locally; no special handling.
- A domain archived/restored while stubs are revealed: handled by 4.5.

[↑ Back to contents](#contents)

## 8. Left to the builder
Language/tooling (plain JS vs TypeScript, bundler or none), file layout, exact DOM selectors and Reddit theme detection (found in the reconnaissance task, section 10), exact colors and spacing, extension name/icon artwork, how rejected context-menu clicks are surfaced, testing approach.

[↑ Back to contents](#contents)

## 9. Acceptance (what "done" looks like)
1. With `thedailybeast.com` blocked, its posts show stubs in the home feed, a subreddit, and a profile, on both old and new Reddit, and nothing is hidden on a post's own page or in search results.
2. A link to `www.thedailybeast.com` and to `x.thedailybeast.com` are both hidden; `notthedailybeast.com` is not.
3. Scrolling to load more posts hides new blocked posts without a visible flash and without breaking scroll.
4. Adding a domain on the options page, or via right-click on a link, hides matching posts in all open Reddit tabs without reload.
5. Show post reveals one post only; Unblock domain archives the domain and restores its posts in all tabs; the domain appears in Archived with Restore.
6. Delete permanently requires the second confirming click.
7. Export then import into a fresh profile reproduces the list, dates, and counts; importing over an existing list offers "larger" vs "sum" and applies the choice.
8. Pasting `https://www.example.com:8080/a/b?c=d#e` stores `example.com`; blocking `reddit.com` is refused.
9. The stub's theme tracks Reddit's theme; the options page tracks the OS theme.
10. Only Add (green) and Remove/Delete permanently (red) are colored; every other button is grey outlined. All buttons show a tooltip, and at 412px wide or narrower they show only their icon, still with an accessible name.
11. Section 6 is met: the automated and manual checks in 6.5 pass, with no WCAG 2.2 AA failures on the options page or the stub.
12. On new Reddit, opening a post in an overlay above a listing (the URL changes without a page load) leaves existing stubs as they are and hides nothing new; closing it rescans the listing. Covered by a test.
13. The flash measurement from 4.2 has been done on old and new Reddit, and its result (flash seen or not, and any pre-paint step added) is recorded in the notes file.
14. A hidden post's node is still in the page (not removed or moved), and restoring it needs only removing the hide class and the stub.

[↑ Back to contents](#contents)

## 10. Build order and milestones

Build in this order. Each milestone ends with a working, usable extension and its own acceptance check. Accessibility (section 6) is built in from M1 on, with final sign-off in M4.

**M0. Reconnaissance (first task, before any product code).** Inspect live old.reddit.com and new Reddit (with the Chrome browser tools if connected) and record in `NOTES.md` at the project root: the real post element and attribute names that give the outbound link on both, how cross-posts look, how listings differ from post pages and from the new-Reddit overlay (URL patterns and navigation events), how each site signals its light/dark theme, and whether blocked posts would visibly flash (4.2). Later milestones read from this file instead of re-guessing. *Done when:* the file exists and covers each item.

**M1. Core blocking.** Manifest, content script, matching (4.1), where it runs (4.2), the hide-in-place stub with Show post and Unblock (4.4), live updates across tabs (4.5), and the options page with add and remove. The full data model (3.1) with `status` and archive-on-remove goes in now, since Remove is already an archive, which avoids a later migration; the Archived section can wait. *Done when:* acceptance 1 to 5, 9, 12, and 14 hold, with accessible stub and options page basics (6.2, 6.3).

**M2. Archive management, stats, and the context menu.** Archived section with Restore and two-step Delete permanently (4.6, 5.3), per-domain counts (3.2, 3.3), and the right-click menu (4.7), including the protected-domain rules (4.3). *Done when:* acceptance 6 and 8 hold and counts show on the options page.

**M3. Import and export.** 5.4 and 5.5 including the larger-or-sum choice and the byte-aware pre-check. *Done when:* acceptance 7 holds.

**M4. Polish and accessibility sign-off.** Button styles, tooltips, and small-viewport behavior (5.6), forced-colors, reflow and zoom checks, the full verification in 6.5, and the flash decision (13). *Done when:* acceptance 10, 11, and 13 hold.

[↑ Back to contents](#contents)

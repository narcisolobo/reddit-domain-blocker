# Reddit Domain Blocker, M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add **Export list** and **Import list…** to the options page: a JSON export of every record with its stats, and an import that validates, previews, merges with a larger-or-sum count choice, and refuses anything that wouldn't fit in sync storage.

**Architecture:** One pure module, `src/shared/transfer.js`, owns the file format: it builds the export, parses and validates an import, plans the merge, and checks the sync limits. The options page uses it directly for Export (a read-only download) and for the import preview. The service worker stays the only writer. It gets a `domain/import` message carrying the file text and the count choice, re-runs the same parse and plan against fresh storage, checks the limits, and writes local stats and then sync records, one `set()` each, rolling back the stats if the sync write fails.

**Tech Stack:** Node 20+, esbuild, jsdom, `@tabler/icons`, Chrome MV3 (`storage`, `contextMenus`). No new permissions: the download uses a blob URL and `<a download>`, not the `downloads` API.

**Spec:** [SPEC.md](../../../SPEC.md), sections 5.4 and 5.5, milestone M3 in section 10. M4 (polish, small-viewport icon-only buttons, accessibility sign-off) is out of scope.

## Global Constraints

Every task includes these, plus the M1 and M2 plans' constraints, which still hold.

- The export file is exactly the 5.4 shape: `schemaVersion` (`1`), `exportedAt` (ISO-8601), `extensionVersion` (from `chrome.runtime.getManifest().version`), and `domains`, an array of `{ domain, status, addedAt, updatedAt, archivedAt, blockedCount, lastBlockedAt, source }` with readable names, ISO-8601 dates, `archivedAt: null` while active, and `lastBlockedAt: null` when never blocked. It includes archived records. Domains are sorted by name.
- Import validates everything before writing anything: valid JSON, `schemaVersion === 1`, and each domain goes through `normalizeInput` (5.1) and must not be protected (4.3). An unreadable file is rejected with a message and changes nothing. Invalid records are skipped and reported (count and reasons).
- Merge rules for a domain on both sides: `addedAt` earliest; `updatedAt` latest; `blockedCount` larger or sum, per the user's choice; `lastBlockedAt` latest; `status` and `archivedAt` from the record with the later `updatedAt` (the existing record wins a tie); `source` stays the existing record's.
- A domain only in the file is added with its stated status, dates, count, and source. A missing or unknown source becomes `"import"`.
- Count choice labels, verbatim: **Use the larger count** (the default) and **Add the two counts together**.
- Import is all-or-nothing. Imported records go to sync in one `set()`, and stats to local in one `set()`. Before writing, the result must stay within 512 sync items and 102,400 bytes minus a 1,024-byte safety margin, where an item's size is its key length plus its JSON length, and the current total comes from `chrome.storage.sync.getBytesInUse(null)`. If it wouldn't fit, refuse the whole import, say by how much, and change nothing.
- The service worker is the only storage writer, on its existing serialized queue. The options page only reads.
- Button styles: **Export list**, **Import list…**, and the review panel's **Import** and **Cancel** are grey outlined (`btn btn-restore`). Each has an icon (`download` for Export, `upload` for Import list… and Import, `x` for Cancel), a visible label, a `title`, and an `aria-label` that contains the visible label.
- Messages: confirmations (export done, import done) go to `#status` (`role="status"`); refusals go to `#action-error` (`role="alert"`). Neither moves focus.

## Review Focus

These are the conditions a user will run into that the spec doesn't spell out. Each one has a test in the task named in brackets.

1. Re-importing your own export with "Use the larger count" changes nothing: no doubled counts, no shifted dates, and no keys written. [Tasks 1 and 2]
2. A hand-edited file mixes good and bad records: `reddit.com`, `not a domain`, a missing date, and `WWW.Example.com` when `example.com` is already listed. The bad records are skipped with reasons, `WWW.Example.com` merges into `example.com` instead of duplicating it, and a domain listed twice in the file (in any spelling) is skipped the second time. [Task 1]
3. The wrong file is picked: an image, an empty file, a JSON array, another app's JSON, or a file over 1 MB. Each shows a message and changes nothing, and the oversized file is never read. [Tasks 1 and 4]
4. An import that would pass 512 items or the byte limit is refused whole, with the overage in the message, and storage is unchanged. A sync write that fails after the stats were written puts the stats back. [Task 2]
5. The list changes between the preview and the click on **Import** (for example a right-click add in another tab). The worker plans against the current storage, the status reports what actually happened, and nothing breaks. [Tasks 2 and 4]

---

### Task 1: The transfer format module

**Files:**
- Create: `src/shared/transfer.js`, `test/transfer.test.js`
- Modify: `src/shared/records.js` (export `validTime`)

**Interfaces:**
- Consumes: `normalizeInput` (`src/shared/domain.js`); `keyFor`, `toStored`, `validTime` (`src/shared/records.js`); `statsKey` (`src/shared/stats.js`).
- Produces, in `src/shared/transfer.js`:
  - `export const SCHEMA_VERSION = 1`
  - `export function buildExport(records: Record[], stats: Map<string, Stats>, { now: number, version: string }): object`. The 5.4 shape. `blockedCount` defaults to 0 and `lastBlockedAt` to `null` when a domain has no stats.
  - `export function exportFilename(now: number): string` → `reddit-domain-blocker-YYYY-MM-DD.json`, using the UTC date.
  - `export function parseImport(text: string): { ok: false, reason: "unreadable" | "unsupported-version" } | { ok: true, entries: Entry[], skipped: Skip[] }`.
    - `Entry` is a `Record` (epoch-ms times, as in `records.js`) plus `blockedCount: number` and `lastBlockedAt: number | null`.
    - `Skip` is `{ index: number, domain: string | null, reason: "invalid-domain" | "protected" | "invalid-record" | "duplicate" }`. `domain` is the raw string from the file if there was one.
    - `"unreadable"`: not JSON, not an object, or `domains` isn't an array. `"unsupported-version"`: `schemaVersion !== 1`.
    - Per record, in this order: not an object → `invalid-record`; `normalizeInput(domain)` reason `protected` → `protected`, any other failure → `invalid-domain`; `status` not `"active"`/`"archived"`, `addedAt` or `updatedAt` not an ISO string that parses to a `validTime`, an archived record without a valid `archivedAt`, or a present `blockedCount` that isn't a non-negative safe integer, or a present non-null `lastBlockedAt` that isn't a valid date → `invalid-record`; a normalized domain already taken by an earlier entry → `duplicate`. An active record's `archivedAt` is ignored (`null`). A missing `blockedCount` is 0 and a missing `lastBlockedAt` is `null`.
  - `export function planImport(records: Record[], stats: Map<string, Stats>, entries: Entry[], countMode: "larger" | "sum"): { added: number, merged: number, syncItems: object, localItems: object }`. `syncItems` maps `d:<domain>` to the stored form, `localItems` maps `stats:<domain>` to `{ blockedCount, lastBlockedAt }`. Each map holds only keys whose value would change. A merged domain with no existing stats counts as `{ blockedCount: 0, lastBlockedAt: null }`. A sum is capped at `Number.MAX_SAFE_INTEGER`.
  - `export const SYNC_MAX_ITEMS = 512`, `export const SYNC_QUOTA_BYTES = 102400`, `export const SYNC_MARGIN_BYTES = 1024`
  - `export function itemBytes(key: string, value: unknown): number` → `key.length + JSON.stringify(value).length`.
  - `export function checkSyncLimits({ currentItems: object, bytesInUse: number, writes: object }): { ok: true } | { ok: false, reason: "too-many" | "too-large", over: number }`. Items after = current keys plus write keys not already present; `over` is items after minus 512. Bytes after = `bytesInUse`, minus `itemBytes` of each overwritten current value, plus `itemBytes` of each written value; `over` is bytes after minus (102400 − 1024). Items are checked first.

- [x] **Step 1: Write the failing tests** in `test/transfer.test.js`:
  ```js
  test("buildExport produces the 5.4 shape with ISO dates, sorted, archived included", () => {
    const records = [rec("b.com", "archived"), rec("a.com")]; // a.com: c 1000, u 2000; b.com adds x 3000, source "m"
    const stats = new Map([["a.com", { blockedCount: 4, lastBlockedAt: 5000 }]]);
    const out = buildExport(records, stats, { now: 9000, version: "0.1.0" });
    assert.equal(out.schemaVersion, 1);
    assert.equal(out.exportedAt, new Date(9000).toISOString());
    assert.equal(out.extensionVersion, "0.1.0");
    assert.deepEqual(out.domains.map((d) => d.domain), ["a.com", "b.com"]);
    assert.deepEqual(out.domains[0], { domain: "a.com", status: "active", addedAt: new Date(1000).toISOString(),
      updatedAt: new Date(2000).toISOString(), archivedAt: null, blockedCount: 4,
      lastBlockedAt: new Date(5000).toISOString(), source: "options" });
    assert.equal(out.domains[1].archivedAt, new Date(3000).toISOString());
    assert.equal(out.domains[1].blockedCount, 0);
    assert.equal(out.domains[1].lastBlockedAt, null);
  });
  test("exportFilename uses the UTC date", ...);              // Date.UTC(2026, 9, 30, 23) -> "reddit-domain-blocker-2026-10-30.json"
  test("export then parse round-trips every field", ...);     // parseImport(JSON.stringify(buildExport(...))).entries deep-equals the records + stats
  test("parseImport rejects unreadable input", ...);          // "", "not json", "[]", "null", '{"schemaVersion":1}', '{"schemaVersion":1,"domains":{}}' -> reason "unreadable"
  test("parseImport rejects other schema versions", ...);     // 2, "1", missing -> "unsupported-version"
  test("parseImport skips bad records with reasons and keeps the rest", () => { // Review Focus 2
    // domains: [ok "a.com", "reddit.com", "not a domain", a record with addedAt "yesterday", 7, archived without archivedAt,
    //            blockedCount -1, "WWW.A.com"]
    // -> entries: [a.com]; skipped reasons in order: protected, invalid-domain, invalid-record, invalid-record,
    //    invalid-record, invalid-record, duplicate; skipped[0] is { index: 1, domain: "reddit.com", reason: "protected" }
  });
  test("parseImport normalizes domains", ...);                // "https://WWW.Example.com/x" -> "example.com"
  test("parseImport defaults missing counts and unknown sources", ...); // no blockedCount/lastBlockedAt -> 0/null; source "zzz" or missing -> "import"
  test("parseImport ignores archivedAt on an active record", ...);
  test("planImport adds file-only domains with their metadata", ...); // added 1, merged 0; syncItems["d:new.com"] equals toStored(entry); localItems["stats:new.com"]
  test("planImport merges per 5.5", () => {
    // existing a.com: active, c 100, u 200, source "options", stats { 5, 300 }
    // file a.com: archived, c 50, u 400, x 400, source "stub", blockedCount 7, lastBlockedAt 250
    // larger -> stored { s: "x", c: 50, u: 400, x: 400, o: "o" }, stats { blockedCount: 7, lastBlockedAt: 300 }
    // sum    -> stats { blockedCount: 12, lastBlockedAt: 300 }
  });
  test("planImport keeps the existing status when the existing record is newer or tied", ...);
  test("planImport writes nothing when re-importing an identical export with larger", ...); // Review Focus 1: syncItems and localItems are {}, merged equals the count
  test("planImport treats missing existing stats as zero", ...);
  test("checkSyncLimits counts only new keys toward 512", ...);    // 510 current + 2 new ok; + 3 new -> { ok: false, reason: "too-many", over: 1 }
  test("checkSyncLimits measures bytes after overwrites", ...);    // bytesInUse near the limit; overwrite with same-size value ok; one more byte than allowed -> too-large with over 1
  ```
- [x] **Step 2: Run** `node --test test/transfer.test.js` and expect FAIL (module missing).
- [x] **Step 3: Implement** `src/shared/transfer.js` and export `validTime` from `records.js`. Convert ISO strings with `Date.parse`, and only accept strings.
- [x] **Step 4: Run** `npm test` and expect PASS for the whole suite.
- [x] **Step 5: Commit** `feat: add the export and import file format`.

---

### Task 2: The `domain/import` message

**Files:**
- Create: `src/background/import.js`, `src/background/errors.js`, `test/import.test.js`
- Modify: `src/background/blocklist.js` (`handleMessage`; import `failureReason` from `errors.js`), `test/helpers/fake-chrome.js`

**Interfaces:**
- Consumes: `parseImport`, `planImport`, `checkSyncLimits` (Task 1); `recordsFromItems`; `statsFromItems`.
- Produces:
  - `export async function importDomains(areas: { sync, local }, text: unknown, countMode: unknown): Promise<Result>` where `Result` is one of:
    - `{ ok: true, outcome: "imported", added: number, merged: number, skipped: number }`
    - `{ ok: false, reason: "unreadable" | "unsupported-version" | "error" }`
    - `{ ok: false, reason: "nothing-to-import", skipped: number }` when no entry survived parsing
    - `{ ok: false, reason: "too-many" | "too-large", over: number }`
    - `{ ok: false, reason: "quota" }` when a write throws a quota error
  - A non-string `text` is `"unreadable"`; a `countMode` other than `"larger"` or `"sum"` is `"error"`.
  - New `handleMessage` case: `"domain/import"` with `msg.text` and `msg.countMode`.
  - `export function failureReason(err): "quota" | "error"` in `src/background/errors.js`, moved unchanged from `blocklist.js`. It lives in its own file because `blocklist.js` imports `import.js`.
  - Fake storage areas gain `getBytesInUse(keys)`, which sums `itemBytes` over the stored items (`null` means all), and `overrideBytesInUse(n)`, which makes later calls return `n`. `failNextSet` already exists on both areas.

- [x] **Step 1: Write the failing tests** in `test/import.test.js`:
  ```js
  test("an import writes stats then records, one set() each", ...); // spy on both set()s: local called before sync, each once
  test("the result reports added, merged and skipped", ...);        // { ok: true, outcome: "imported", added: 1, merged: 1, skipped: 1 }
  test("re-importing your own export writes nothing", ...);          // Review Focus 1: no set() call on either area
  test("an import over 512 items is refused and changes nothing", ...); // Review Focus 4: 511 existing + 2 new -> { ok: false, reason: "too-many", over: 1 }
  test("an import over the byte limit is refused and changes nothing", ...); // overrideBytesInUse(102000) -> reason "too-large", over > 0
  test("a failed sync write restores the stats that were written", async () => { // Review Focus 4
    // local has stats:a.com { 5, 300 }; file merges a.com with sum and adds new.com
    // sync.failNextSet(new Error("QUOTA_BYTES quota exceeded"))
    // -> { ok: false, reason: "quota" }; stats:a.com is back to { 5, 300 }; stats:new.com is absent; no d:new.com
  });
  test("unreadable text, a bad countMode, and an all-skipped file are refused", ...); // unreadable; error; nothing-to-import with skipped 2
  test("the worker plans against current storage, not the preview", ...); // Review Focus 5: add c.com after parsing the preview; the file contains c.com -> merged 1, added 0
  test("handleMessage routes domain/import", ...);
  ```
- [x] **Step 2: Run** `node --test test/import.test.js` and expect FAIL.
- [x] **Step 3: Implement** `importDomains`. Read `sync.get(null)`, `local.get(null)`, and `sync.getBytesInUse(null)`; plan; check limits against `syncItems`; write `localItems` if non-empty, then `syncItems` if non-empty. If the local write throws, nothing has changed, so return its `failureReason`. If the sync write throws, put back each written stats key's previous value (`set`) and remove the keys that had none (`remove`), then return `failureReason(err)`. Add the fake's `getBytesInUse` and `overrideBytesInUse`, and the `handleMessage` case.
- [x] **Step 4: Run** `npm test` and expect PASS.
- [x] **Step 5: Commit** `feat: import domains in the service worker with an all-or-nothing limit check`.

---

### Task 3: Export list on the options page

**Files:**
- Modify: `scripts/gen-icons.js` (add `download` and `upload`), `src/shared/icons.js` (regenerated by `npm run gen-icons`), `test/icons.test.js`, `extension/options.html`, `extension/options.css`, `src/options/index.js`, `src/options/view.js` (`messageFor`), `test/options.test.js`, `test/helpers/fake-chrome.js` (`runtime.getManifest()` returns `{ version: "0.1.0" }`)

**Interfaces:**
- Consumes: `buildExport`, `exportFilename` (Task 1).
- Produces:
  - In `options.html`, after `#error` and before the first `<section>`: `<div class="transfer">` holding `<button type="button" class="btn btn-restore" id="export-button">` and `<button type="button" class="btn btn-restore" id="import-button">` (the import button is wired in Task 4), and `<input type="file" id="import-file" accept=".json,application/json" hidden>`.
  - Export: `aria-label="Export list"`, `title="Download your list as a JSON file"`, label **Export list**, icon `download`. Import: `aria-label="Import list…"`, `title="Load a list from an exported JSON file"`, label **Import list…**, icon `upload`. Their markup is set by `init`, like the Add button's.
  - Clicking Export reads both areas (fresh, not the cached render), builds the file with `now = Date.now()` and `version = chrome.runtime.getManifest().version`, and downloads it as `JSON.stringify(data, null, 2)` in a `Blob` of type `application/json`, through a temporary `<a download="<exportFilename>">`, then revokes the object URL. Use `document.defaultView.URL` and `document.defaultView.Blob`, so tests can stub `createObjectURL`, which jsdom lacks. Status: `Exported <n> domain(s)`, from a new `messageFor` outcome `"exported"` with `count`.
  - `messageFor({ ok: true, outcome: "exported", count })` → `{ kind: "status", text: "Exported 1 domain" | "Exported 3 domains" }`.

- [x] **Step 1: Write the failing tests.** Add `download` and `upload` to the names in `test/icons.test.js`. In `test/options.test.js`:
  ```js
  test("Export list and Import list… buttons are grey outlined with icons, labels and tooltips", ...);
  test("Export downloads every record as JSON and announces it", async () => {
    // sync: d:a.com active, d:b.com archived; local: stats:a.com
    // stub dom.window.URL.createObjectURL (capture the Blob) and revokeObjectURL; capture clicks on a[download] and preventDefault
    // -> anchor.download matches /^reddit-domain-blocker-\d{4}-\d{2}-\d{2}\.json$/; JSON.parse(await blob.text()).domains has a.com and b.com
    // -> #status is "Exported 2 domains"; revokeObjectURL called with the created URL; focus stays on Export
  });
  test("messageFor exported pluralizes", ...);
  ```
- [x] **Step 2: Run** `node --test test/icons.test.js test/options.test.js` and expect FAIL.
- [x] **Step 3: Implement.** Add the icon names and run `npm run gen-icons`. Add the markup, the `.transfer` style (a flex row with a `0.5rem` gap and `1.5rem` top margin), the click handler, and the `messageFor` case. If reading storage throws, show the generic error.
- [x] **Step 4: Run** `npm test` and `npm run build`, and expect PASS and a clean build.
- [x] **Step 5: Commit** `feat: export the list as JSON from the options page`.

---

### Task 4: Import review on the options page

**Files:**
- Create: `src/options/import-view.js`
- Modify: `src/options/index.js`, `src/options/view.js` (`messageFor`), `extension/options.html`, `extension/options.css`, `test/options.test.js`

**Interfaces:**
- Consumes: `parseImport`, `planImport` (Task 1); the `domain/import` message and its results (Task 2); the buttons and file input (Task 3).
- Produces:
  - In `options.html`, right after `.transfer`: `<div id="import-review"></div>`, empty until a file is chosen.
  - `export const MAX_IMPORT_BYTES = 1048576` (in `import-view.js`).
  - `export function skipText(skip: Skip): string` → `<domain or "Entry <index + 1>"> <reason>`, where the reasons read: `invalid-domain` "isn't a valid domain", `protected` "is a Reddit domain", `invalid-record` "has missing or invalid fields", `duplicate` "appears more than once".
  - `export function renderImportReview(root, { added, merged, skipped: Skip[] }, { onImport(countMode), onCancel }): void`. It renders a `<section aria-labelledby="import-heading">` with `<h2 id="import-heading" tabindex="-1">Review import</h2>`; a summary paragraph `<added> new, <merged> merged, <skipped.length> skipped`; when there are skips, a `<ul>` of up to 10 `skipText` lines plus `and <n> more` if needed; when `merged > 0`, a `<fieldset>` with `<legend>Counts for domains already on your list</legend>` and two radios named `count-mode` with values `larger` (checked) and `sum`, labelled **Use the larger count** and **Add the two counts together**; and two buttons, **Import** (`aria-label="Import"`, `title="Add these domains to your list"`, icon `upload`) and **Cancel** (`aria-label="Cancel import"`, `title="Don't import"`, icon `x`). Escape anywhere in the section calls `onCancel`. `onImport` receives the checked radio's value, or `"larger"` when there's no fieldset.
  - `export function clearImportReview(root): void`.
  - New `messageFor` cases:
    - outcome `"imported"` → status `Imported: <added> new, <merged> merged, <skipped> skipped.`
    - reason `"unreadable"` → `That file isn't a Reddit Domain Blocker export. Nothing was imported.`
    - reason `"unsupported-version"` → `That export is from a different version of Reddit Domain Blocker. Nothing was imported.`
    - reason `"nothing-to-import"` → `Nothing to import: every entry in that file was skipped.`
    - reason `"too-many"` → `That import would go over Chrome's limit of 512 domains by <over>. Nothing was imported.`
    - reason `"too-large"` → `That import would go over Chrome's sync storage limit by about <ceil(over / 1024)> KB. Nothing was imported.`
    - reason `"file-too-big"` → `That file is too large to be an export. Nothing was imported.`
  - Flow in `index.js`: **Import list…** clicks the hidden file input. On `change`, take `files[0]` (do nothing if none), then reset the input's value so the same file can be chosen again. A file over `MAX_IMPORT_BYTES` is refused as `"file-too-big"` without calling `text()`. Otherwise parse it; refuse `"unreadable"`, `"unsupported-version"`, or (when there are no entries) `"nothing-to-import"` through `show()` with no review. Else plan against the cached records and stats, render the review, and focus `#import-heading`. **Import** sends `{ type: "domain/import", text, countMode }`, clears the review, shows `messageFor(result)`, and focuses **Import list…**. **Cancel** and Escape clear the review and focus **Import list…**. Choosing a new file replaces an open review.

- [x] **Step 1: Write the failing tests** in `test/options.test.js`. Simulate a file pick by defining `files` on the input (`Object.defineProperty(input, "files", { value: [file], configurable: true })`) and dispatching `change`, with `file` a `{ name, size, text: async () => json }` object:
  ```js
  test("picking a file shows the review with counts and skips, and focuses its heading", ...);
  test("the count choice appears only when a domain is on both sides, larger by default", ...);
  test("Import sends domain/import with the text and the chosen mode, then announces the result", ...); // choose sum; #status "Imported: 1 new, 1 merged, 0 skipped."; focus on Import list…
  test("imported domains and counts appear without a reload", ...);  // the table shows the new domain and its Posts hidden count
  test("Cancel and Escape close the review, write nothing, and return focus to Import list…", ...);
  test("an unreadable or wrong-version file shows an alert and no review", ...); // Review Focus 3: "", "{}", "[]", '{"schemaVersion":2,"domains":[]}'
  test("a file over 1 MB is refused without being read", ...);       // Review Focus 3: size 1048577, text() throws if called
  test("a refused import shows the overage", ...);                  // worker returns too-many over 3 -> #action-error names 3
  test("a status from the worker, not the preview, is what's announced", ...); // Review Focus 5: add c.com between pick and Import -> "0 new, 1 merged" reported
  test("skipText reads naturally and the list stops at 10", ...);
  ```
- [x] **Step 2: Run** `node --test test/options.test.js` and expect FAIL.
- [x] **Step 3: Implement** `import-view.js`, the flow in `index.js`, the `messageFor` cases, and the styles: the review is a bordered band (`1px solid var(--rule)`, `6px` radius, `1rem` padding) with the fieldset's border removed and its radios stacked, and its buttons in a row with a `0.5rem` gap. Keep `role="status"` and `role="alert"` as the only live regions; the review itself isn't live, because focus moves to its heading.
- [x] **Step 4: Run** `npm test` and `npm run build`, and expect PASS and a clean build.
- [x] **Step 5: Commit** `feat: review and import an exported list on the options page`.

---

### Task 5: Live verification and docs

**Files:**
- Modify: `NOTES.md`, `README.md`, this plan (tick the boxes)

The automation browser can't open `chrome://extensions`, so the owner runs these in their own Chrome with `extension/` loaded unpacked and reports back.

- [x] **Step 1: The owner runs the checks:**
  1. Export downloads `reddit-domain-blocker-<date>.json`. It holds every active and archived domain with ISO dates and counts, and the status line says how many.
  2. In a fresh Chrome profile, loading the extension and importing that file reproduces the list, the dates, the archived entries, and the counts (acceptance 7).
  3. Importing the same file again with **Use the larger count** leaves every count and date unchanged. With **Add the two counts together**, counts double.
  4. A hand-edited file with `reddit.com`, `not a domain`, and a duplicate shows them as skipped with reasons, and imports the rest.
  5. Picking an image or an empty file shows an alert and changes nothing.
  6. With a Reddit tab open, an import that adds an active domain hides its posts without a reload.
  7. Keyboard only: Export, Import list…, choosing a file, the radios, Import, Cancel, and Escape all work, and focus lands on the review heading and returns to Import list….
  8. The service worker console has no errors.
- [x] **Step 2: Fix any failures**, one commit per fix, each with a test where jsdom can express it.
- [x] **Step 3: Record the results** in `NOTES.md` under `## M3 verification`, in the same table form as M1 and M2. Update the `README.md` status line: M3 is implemented and checked by hand, and polish and the accessibility sign-off (M4) are still to come. Tick this plan's boxes.
- [x] **Step 4: Commit** `docs: record M3 verification`.

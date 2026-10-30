# Reddit Domain Blocker, M4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the polish and accessibility sign-off: icon-only buttons at small widths, tables that reflow at 320px, forced-colors support, contrast and automated accessibility checks in the test suite, the deferred M4 items, and the owner's manual 6.5 verification.

**Architecture:** No new features and no new permissions. CSS and markup changes on the options page (`extension/options.css`, `extension/options.html`, `src/options/view.js`) and in the two shadow-DOM components injected into Reddit (`src/content/stub.js`, `src/content/notice.js`), which will share one palette module. Two new kinds of test pin the visual rules that jsdom can't render: a contrast test that reads the color tokens out of the stylesheets and computes WCAG ratios, and an axe-core run over the rendered options page, stub, and notice.

**Tech Stack:** Node 20+, esbuild, jsdom, `@tabler/icons`, and `axe-core` (new, dev-only). Chrome MV3.

**Spec:** [SPEC.md](../../../SPEC.md), sections 4.4, 5.6, and 6, acceptance 10, 11, and 13, milestone M4 in section 10.

## Global Constraints

Every task includes these, plus the M1–M3 plans' constraints, which still hold.

- Target: WCAG 2.2 Level AA for the options page and for everything injected into Reddit (the stub and the notice).
- **Small viewports (412px wide and narrower):** button text is hidden and only the icon shows, on the options page and in the stub (and the notice, which shares the stub's button style). Icon-only buttons keep their accessible name (`aria-label`) and tooltip, and a touch target of at least 44×44px. Use a CSS media query (`max-width: 412px`); in the shadow DOM it must work inside the isolated root.
- The inline delete confirmation keeps its visible text "Really delete?" at every width; only its buttons go icon-only.
- **Tooltips:** every button has a `title` naming its action and an `aria-label` that contains its visible label (2.5.3). Same action, same icon, same name everywhere (3.2.4).
- **Button styles:** only Add is green and only Remove, Delete permanently, and Confirm are red; every other button is grey outlined. Colors must pass in light and dark.
- **Contrast:** text and meaningful icons at least 4.5:1 against their background (3:1 for large text); component boundaries, icon-only buttons, and focus indicators at least 3:1 (1.4.3, 1.4.11). The stub and notice are checked against both of Reddit's themes.
- **Forced colors:** under `@media (forced-colors: active)`, buttons, borders, and focus rings stay visible using system colors.
- **Reflow:** the options page reflows at 320 CSS px with no horizontal scrolling (1.4.10); at that width the tables become stacked rows rather than scrolling sideways. Usable at 200% zoom and with overridden text spacing (1.4.4, 1.4.12). Use relative units on the options page.
- **Motion:** honor `prefers-reduced-motion`; no animation is required anywhere, and none may be added.
- Tables keep a programmatic name and `<th scope="col">` headers; the count column header stays "Posts hidden".
- Status uses `role="status"`, errors `role="alert"`, and neither moves focus (4.1.3). Focus behavior from M2 and M3 is unchanged.

## Review Focus

These are the conditions a user will run into that the spec doesn't spell out. Each one has a test in the task named in brackets.

1. At 412px and narrower, the small Confirm and Cancel buttons (`.btn-small`) must grow to 44×44 like every other icon-only button, not stay at their 28px desktop size. [Task 2]
2. In the stacked table layout, a screen reader must hear each cell's column header once, not twice. The visible "Posts hidden" label shown beside a stacked value must be `aria-hidden`, because the header is already announced. [Task 3]
3. A 60-character domain at 320px must wrap inside its row, in both tables and in the stub, without pushing the page wider than the viewport. [Tasks 3 and 4]
4. Under forced colors, Add and Remove lose their green and red fills. They must still read as buttons with a visible border, and the icon and label must stay visible. [Task 2]
5. With the Archived table stacked, opening a delete confirmation must keep "Really delete?" visible, focus Confirm, and return focus to Delete on Escape, exactly as at desktop width. [Task 3]

---

### Task 1: Shared content palette and the contrast test

**Files:**
- Create: `src/content/palette.js`, `test/contrast.test.js`, `test/helpers/contrast.js`
- Modify: `src/content/stub.js`, `src/content/notice.js` (use the shared palette), and, only if the new test finds a failing pair, `extension/options.css` or `src/content/palette.js` (adjust the failing color, keeping its hue)

**Interfaces:**
- Produces, in `src/content/palette.js`:
  - `export const LIGHT` and `export const DARK`, each an object `{ bg, fg, border, btnBg, btnHover, focus, error }` of `#rrggbb` strings, holding the values currently duplicated in `stub.js` and `notice.js`.
  - `export function paletteCss(selector: string): string`, which returns the two custom-property blocks the stub and notice use today: `${selector} { --rdb-bg: …; … }` from `LIGHT`, and `${selector}[data-theme="dark"] { … }` from `DARK`.
- Produces, in `test/helpers/contrast.js`:
  - `export function contrast(a: string, b: string): number`, the WCAG 2.x contrast ratio of two `#rrggbb` colors.
  - `export function cssTokens(css: string, selector: string): Record<string, string>`, which reads the `--name: #rrggbb` declarations inside the first block whose selector text matches exactly, such as `:root`, or the `:root` inside `@media (prefers-color-scheme: dark)`. Shorthand `#rgb` values are expanded.
- `stub.js` and `notice.js` build their `STYLE` with `paletteCss(".bar")` and `paletteCss(".box")`, and their rendered CSS is otherwise unchanged. Delete the "Palette values mirror the stub's…" comment in `notice.js`.

- [x] **Step 1: Write the failing tests** in `test/contrast.test.js`. Read `extension/options.css` from disk. Reddit page backgrounds are `#ffffff` (new Reddit light, and old Reddit) and `#0e1113` (new Reddit dark).
  ```js
  test("contrast helper matches known WCAG ratios", () => {
    assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
    assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
  });
  for (const theme of ["light", "dark"]) {
    test(`options page ${theme}: text pairs reach 4.5:1`, ...);
    // --text/--bg, --muted/--bg, --error/--bg, --add-text/--add-bg, --remove-text/--remove-bg, --grey-text/--bg
    test(`options page ${theme}: boundaries and focus reach 3:1`, ...);
    // --border/--bg, --grey-border/--bg, --focus/--bg, --add-bg/--bg, --remove-bg/--bg
    test(`stub and notice ${theme}: text reaches 4.5:1`, ...);
    // fg/bg, fg/btnBg, fg/btnHover, error/bg
    test(`stub and notice ${theme}: boundaries and focus reach 3:1`, ...);
    // border/bg, border/btnBg, focus/bg, and border against the Reddit page background(s) for that theme
  }
  test("stub and notice render the same palette", ...); // both STYLE strings contain paletteCss output; no #rrggbb literal outside it
  ```
  Each assertion message names the pair and the ratio, for example `assert.ok(r >= 4.5, \`--muted on --bg is ${r.toFixed(2)}\`)`.
- [x] **Step 2: Run** `node --test test/contrast.test.js` and expect FAIL (modules missing).
- [x] **Step 3: Implement** the palette module and the helper, and switch `stub.js` and `notice.js` over to `paletteCss`. Run the contrast test. If a pair fails, adjust the failing token by the smallest lightness change that passes, keeping its hue, and list every change (old value, new value, ratio before and after) in your report.
- [x] **Step 4: Run** `npm test` and expect PASS. The existing stub and notice tests must pass unchanged.
- [x] **Step 5: Commit** `feat: share the content palette and test color contrast`.

---

### Task 2: Options page buttons: names, icon-only at 412px, forced colors

**Files:**
- Modify: `src/options/index.js` (the Add button), `extension/options.css`, `test/options.test.js`

**Interfaces:**
- Consumes: the existing `rowButton`, `confirmGroup`, Export/Import, and review buttons. Their markup is `icon` plus `<span>label</span>`.
- Produces:
  - The Add button gets `aria-label="Add"` and `title="Add this domain to your list"`.
  - In `options.css`, a `@media (max-width: 412px)` block:
    - `.btn > span` is hidden with `display: none`;
    - `.btn` and `.btn-small` get `min-width: 44px; min-height: 44px; justify-content: center; padding: 0.5rem`;
    - `.btn svg` is set to `width: 20px; height: 20px`.
    `.confirm-text` is not affected.
  - In `options.css`, a `@media (forced-colors: active)` block: `.btn` gets `border: 1px solid ButtonText`, `:focus-visible` gets `outline-color: Highlight`, and `input[type="text"]` gets `border-color: CanvasText`.

- [x] **Step 1: Write the failing tests** in `test/options.test.js`:
  ```js
  test("every button has an icon, a visible label, a title, and an aria-label containing the label", async () => {
    // setup with one active and one archived domain; open the delete confirmation; pick a file so the review is open
    for (const b of document.querySelectorAll("button")) {
      const label = b.querySelector("span")?.textContent ?? "";
      assert.ok(b.querySelector("svg[aria-hidden=true]"), `${label}: icon`);
      assert.ok(label.length > 0, "visible label");
      assert.ok(b.title.length > 0, `${label}: title`);
      assert.ok(b.getAttribute("aria-label")?.includes(label), `${label}: aria-label contains label`);
    }
  });
  test("options.css hides button text and enlarges targets at 412px, including btn-small", () => {
    // read extension/options.css; find the @media (max-width: 412px) block; assert it hides `.btn > span`,
    // sets min-width and min-height 44px on a selector list containing both .btn and .btn-small,
    // and does not mention .confirm-text  (Review Focus 1)
  });
  test("options.css has a forced-colors block for buttons, focus, and the input", ...); // Review Focus 4
  ```
- [x] **Step 2: Run** `node --test test/options.test.js` and expect FAIL (the Add button has no `title` or `aria-label`, and the CSS blocks are missing).
- [x] **Step 3: Implement** the Add button attributes and the two CSS blocks. For the CSS assertions, use a small regex that extracts a media block's body from the stylesheet text, written inline in the test.
- [x] **Step 4: Run** `npm test` and `npm run build`, and expect PASS and a clean build.
- [x] **Step 5: Commit** `feat: icon-only option buttons at small widths and forced-colors styles`.

---

### Task 3: Tables that stack at narrow widths, without the duplicate caption

**Files:**
- Modify: `src/options/view.js` (`buildTable`, `countCell`, `updateCounts`, `renderList`, `renderArchived`), `extension/options.css`, `test/options.test.js`. Two kinds of existing test change: the caption assertions in "renderList shows active domains only…" and "archived table: caption, …" move to the new naming, and every assertion that reads a count cell's `textContent` reads its `.count-value` instead, since the cell now also holds the stacked-layout label.

**Interfaces:**
- Consumes: `buildTable(doc, captionText, headers)` today.
- Produces:
  - `buildTable(doc, labelledBy: string, headers)`: no `<caption>`. The table gets `aria-labelledby` set to the section heading's id (`active-heading` or `archived-heading`). This removes the duplicate "Blocked domains / Blocked domains" and "Archived / Archived domains" that M2 deferred to M4.
  - Explicit roles, so the table keeps its semantics when CSS changes its `display`: `table` `role="table"`, `thead` and `tbody` `role="rowgroup"`, `tr` `role="row"`, `th` `role="columnheader"`, `td` `role="cell"`.
  - Each data cell except the actions cell starts with `<span class="cell-label" aria-hidden="true">` holding its column's header text ("Domain", "Archived", "Posts hidden"). It is hidden at desktop width.
  - In `options.css`, a `@media (max-width: 32rem)` block: `table.domains`, `tbody`, `tr`, and `td` are `display: block`; `thead` is visually hidden with the existing `.visually-hidden` pattern; each `tr` is a band with the existing row rule and padding; `.cell-label` shows inline as muted text before the value; `td.count` aligns left; `td.actions` is not `nowrap` and aligns left; and `td.domain` keeps `overflow-wrap: anywhere`.

- [x] **Step 1: Write the failing tests** in `test/options.test.js`:
  ```js
  test("tables are named by their section heading, with no caption", ...);
  // table[aria-labelledby=active-heading] and [archived-heading]; no caption element anywhere
  test("tables carry explicit table roles", ...);  // table/rowgroup/row/columnheader/cell as listed
  test("stacked-layout cell labels are aria-hidden and match the column headers", ...); // Review Focus 2
  // in the archived table: each row's .cell-label texts are ["Domain", "Archived", "Posts hidden"]; every one has aria-hidden="true"
  test("options.css stacks tables at 32rem and hides thead visually, not with display:none", ...);
  test("the delete confirmation works the same with the stacked markup", ...); // Review Focus 5
  // open it: "Really delete?" present, Confirm focused; Escape returns focus to Delete permanently
  ```
  Update the two existing caption assertions to check `aria-labelledby` instead.
- [x] **Step 2: Run** `node --test test/options.test.js` and expect FAIL.
- [x] **Step 3: Implement** the markup and the CSS. Keep the `data-count-for` cell updates working: `updateCounts` writes `textContent`, which would delete the label span. Change it to update a dedicated `<span class="count-value">` inside the cell, and update `countCell` to match.
- [x] **Step 4: Run** `npm test` and `npm run build`, and expect PASS and a clean build. The "count updates don't rebuild the table" test from M2 must still pass.
- [x] **Step 5: Commit** `feat: stack the options tables at narrow widths and name them by their headings`.

---

### Task 4: Stub and notice: hidden marker icon, icon-only at 412px

**Files:**
- Modify: `src/content/stub.js`, `src/content/notice.js`, `test/stub.test.js`, `test/notice.test.js`

**Interfaces:**
- Consumes: `paletteCss` (Task 1).
- Produces:
  - The stub's label starts with the `ban` icon, `aria-hidden`, then the text `Hidden: <domain>` or `Shown: <domain>`, as spec 4.4 asks ("Icon + text"). The group's `aria-label` is unchanged.
  - In both components' `STYLE`, a `@media (max-width: 412px)` block: `button > span { display: none; }`, and `button` gets `min-width: 44px; min-height: 44px; justify-content: center; padding: 8px`. The stub's `.label` still truncates or wraps, and never forces the bar wider than its container.
  - `stub.js` `setDomain` keeps the icon when it rewrites the label text. Write the text into a dedicated `<span class="label-text">`.

- [x] **Step 1: Write the failing tests:**
  ```js
  test("the stub label shows the ban icon before the text, aria-hidden", ...);
  test("setDomain keeps the icon and updates only the text", ...);
  test("stub buttons go icon-only with 44px targets at 412px", ...);  // STYLE contains the media block; every button has aria-label and title
  test("a 60-character domain wraps instead of widening the stub", ...); // Review Focus 3: .label has min-width 0 and overflow-wrap anywhere in STYLE
  test("notice Dismiss goes icon-only with a 44px target at 412px", ...);
  ```
- [x] **Step 2: Run** `node --test test/stub.test.js test/notice.test.js` and expect FAIL.
- [x] **Step 3: Implement.** Keep `all: initial` on `:host`.
- [x] **Step 4: Run** `npm test` and `npm run build`, and expect PASS and a clean build.
- [x] **Step 5: Commit** `feat: hidden-marker icon and icon-only buttons in the stub and notice`.

---

### Task 5: Automated accessibility pass with axe-core

**Files:**
- Modify: `package.json` (`axe-core` as a devDependency, exact version), `package-lock.json`
- Create: `test/axe.test.js`
- Modify: only if axe finds a violation, the file that causes it

**Interfaces:**
- Consumes: the options page (`setup()`-style JSDOM from `options.html` plus `init`), `createStub`, and the notice's public API from `src/content/notice.js`.
- Produces: a test that injects `axe.source` into the JSDOM window and runs `axe.run(document, { rules: { "color-contrast": { enabled: false } } })` for each state below. `color-contrast` is off because jsdom doesn't compute styles, and Task 1's test covers contrast. It asserts `violations` is empty, with a message listing each violation's id and target.

- [x] **Step 1: Write the tests** in `test/axe.test.js`:
  ```js
  test("axe: options page, empty", ...);
  test("axe: options page with active and archived rows", ...);
  test("axe: options page with the delete confirmation open", ...);
  test("axe: options page with the import review open, skips listed, count choice shown", ...);
  test("axe: options page with an add-field error and a row-action error", ...);
  test("axe: a hidden stub and a shown stub in a Reddit-like page", ...); // run axe on the host's shadow root content
  test("axe: the notice shown with a refusal message", ...);
  ```
  For the shadow-DOM components, attach them to a plain `<main>` in a JSDOM document and run axe on the document. axe-core walks open shadow roots.
- [x] **Step 2: Run** `node --test test/axe.test.js`. Any failure is a real finding: fix the cause in the source, not by disabling a rule. Disabling any rule other than `color-contrast` needs a comment naming why jsdom can't evaluate it.
- [x] **Step 3: Run** `npm test` and expect PASS. The test output must stay clean, with no axe console noise.
- [x] **Step 4: Commit** `test: run axe-core over the options page, stub, and notice`.

---

### Task 6: Owner's manual sign-off (6.5) and docs

**Files:**
- Modify: `NOTES.md`, `README.md`, this plan (tick the boxes)

The automation browser can't open reddit.com or `chrome://extensions`, so the owner runs these in their own Chrome with `extension/` loaded unpacked and reports back.

- [x] **Step 1: The owner runs the checks:**
  1. **Lighthouse** accessibility audit of the options page, in DevTools. Record the score and any items.
  2. **Small viewport:** in DevTools device mode at 412px and at 320px, every options-page button is icon-only with a tooltip on hover, "Really delete?" stays as text, the tables stack, and nothing scrolls sideways. Repeat at 375px with the Archived table filled. On Reddit at 412px or narrower, the stub's buttons are icon-only.
  3. **Zoom and spacing:** at 200% browser zoom the options page is usable with no clipped or overlapping text. Apply a text-spacing bookmarklet (line height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16) and check the same.
  4. **Forced colors:** DevTools > Rendering > Emulate CSS media feature `forced-colors: active`. On the options page and on a Reddit stub, buttons have visible borders, the focus ring shows, and Add and Remove are still readable.
  5. **Contrast in context:** the stub on new Reddit light, new Reddit dark, and old Reddit is readable, and its border is visible against the page.
  6. **Keyboard only:** every flow in spec section 9 that has UI (add, remove, restore, two-step delete, export, import, Show post / Hide post, Unblock domain, the notice's Escape) works with no mouse and no trap, with focus always visible.
  7. **Screen reader, VoiceOver (macOS):** the options page (headings, both tables, the count column, status and error announcements, the import review summary) and a stub on Reddit (its group name and buttons). One of NVDA or JAWS as well, if the owner has a Windows machine. If not, record that it wasn't run.
  8. **Flash (acceptance 13):** confirm the M1 finding still holds: no visible flash of blocked posts on cold load or infinite scroll, on new and old Reddit.
- [x] **Step 2: Fix any failures**, one commit per fix, each with a test where jsdom can express it.
- [x] **Step 3: Record the results** in `NOTES.md` under `## M4 verification`, in the same table form as earlier milestones, including the flash decision (no pre-paint step added, if check 8 holds) and any screen-reader gap. Update the `README.md` status line: all milestones (M0–M4) are implemented and checked. Tick this plan's boxes.
- [x] **Step 4: Commit** `docs: record M4 verification`.

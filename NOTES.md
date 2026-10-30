# Reddit markup notes (M0)

Findings from live Reddit, recorded 2026-10-29 from output the owner pasted from DevTools (the Chrome browser tool is blocked from reddit.com). Items marked **unverified** are assumptions to confirm in Task 14. The fixtures in `test/fixtures/` are reconstructed from the real attributes, with the noisy inner markup removed. The owner has the Reddit Enhancement Suite (RES) installed, which adds many `res-*` classes to `html`/`body`; none of the signals below depend on those classes.

## New Reddit post element

- Post element: `shreddit-post`. Parent chain from a subreddit listing: `shreddit-post` → `article#<uuid>` → `shreddit-feed` → `div` → `div#i18n-shreddit-feed-content` → `main#main-content`.
- Outbound link: `content-href`. Post id: `id` attribute, Reddit fullname form `t3_<id>`. Type: `post-type`. Also present: `domain` (Reddit's own host parse), `permalink` (path), `post-title`, `subreddit-name`.
- `content-href` by `post-type` (seen on the home feed and r/news):

  | post-type | content-href | `domain` attr |
  | --- | --- | --- |
  | `link` | external URL, e.g. `https://www.cbr.com/stick-season-2-review/` | `cbr.com` |
  | `text` | the post's own reddit.com permalink | `self.<subreddit>` |
  | `image` | `https://i.redd.it/...` | `i.redd.it` |
  | `video`, `gif` | `https://v.redd.it/...` | `v.redd.it` |
  | `gallery` | `https://www.reddit.com/gallery/<id>` | `reddit.com` |
  | `crosspost` | a **relative** path to the original post, e.g. `/r/MadeMeSmile/comments/1xi3637/...` | see Cross-posts |

  Only `link` posts carry an external host in `content-href`; every other type resolves to a Reddit domain or a relative path, which the spec already treats as "no outbound link".
- Wrapper: each `shreddit-post` is the only child of an `article`. Whether to hide the `article` too (to avoid leftover spacing) is **open**; decide in Task 14 by inspecting a hidden post live.

## Old Reddit post element

Seen on `https://old.reddit.com/r/news/` (25 posts, all links):

- Post element: `div.thing.link` with `id="thing_t3_<id>"`, a direct child of `#siteTable`. Followed by a spacer sibling `div.clearleft`; hide both (the `.thing` and its next sibling when it is `.clearleft`).
- Outbound link: `data-url` (external URL for a link post). Post id: `data-fullname` (`t3_<id>`). Also: `data-domain` (`apnews.com`), `data-permalink` (path), `data-type="link"`, `data-is-gallery`, `data-num-crossposts`.
- RES adds classes such as `res-selected` and `RES-keyNav-activeThing` to a `.thing`; do not match on or remove them.
- Self posts (seen on r/AskReddit): the `.thing` also has the class `self`; `data-url` is the relative permalink and `data-domain` is `self.<subreddit>`. Same `#siteTable` parent and `div.clearleft` spacer. So `data-url` yields no outbound link for them.
- Galleries (seen on r/Damnthatsinteresting): `data-is-gallery="true"`, `data-url="https://www.reddit.com/gallery/<id>"`, and `data-domain="old.reddit.com"` (not `reddit.com`). `data-url` is a protected Reddit domain, so no outbound link. Do not use `data-domain` for matching.
- Cross-posts: see the Cross-posts section. (`data-num-crossposts` counts how many times a post was *cross-posted*, not whether it is one; the "crosspost" link in the action row is the button to cross-post it.)
- Theme: `html` has no dark class, computed `color-scheme` is `normal`, and the body background is `rgb(255, 255, 255)` (light), with RES loaded.

## Cross-posts

- New Reddit: `post-type="crosspost"`, `is-crosspost=""` attribute, and `content-href` is a relative path to the original *Reddit* post, so `hostnameOf` yields `null` and the post is never hidden (the spec's v1 default).
- The `domain` attribute on the one example was `v.redd.it` (the original is a Reddit video), so it may carry the *original's* link domain. **Unverified** for a cross-post of an external link; if confirmed in Task 14, it could be used as a fallback for cross-posts. Do not rely on it before then.
- Old Reddit (seen on r/PublicFreakout, two real cross-posts, confirmed by the owner in the mobile app): the `.thing` has `data-crosspost-root-*` attributes (`-title`, `-author`, `-subreddit`, `-score`, `-num-comments`, `-time`), `data-target-root-fullname` / `data-target-parent-fullname` (the original's fullname), and the entry contains `<span class="crosspost-badge">` after the domain. Distinguish from the non-cross-post "crosspost" action link, which is only a button.
- Crucially, on old Reddit a cross-post's `data-url` and `data-domain` carry the **original's link** (both examples: `https://v.redd.it/...`, `v.redd.it`, an original Reddit video), not a permalink. So `data-url` works as-is for old-Reddit cross-posts, and a cross-post of a blocked outlet's article would very likely be matched. Verified only with Reddit-hosted originals; confirm with an external-link original in Task 14.

## Page types and URLs

- Listings seen on new Reddit: `https://www.reddit.com/` (home, `view-context="AggregateFeed"`), `https://www.reddit.com/r/news/` and `.../r/AskReddit/` (`view-context="SubredditFeed"`). On old Reddit: `https://old.reddit.com/`, `.../r/news/`, `.../r/AskReddit/`, `.../r/PublicFreakout/`. `r/all` is deprecated, so use home, `r/popular`, or a subreddit for listings.
- Post page, new Reddit: `https://www.reddit.com/r/<sub>/comments/<id>/<slug>/`, opened in the **same tab** with **no overlay** (verified by the owner). Old Reddit uses the same path on `old.reddit.com` (seen in `data-permalink` and the comments link). The plan's `isPostPage` pattern matches both.
- The new-Reddit post page shows more feed items below the post (an ad was visible); the spec already says nothing is hidden on a post's own page, including related-post lists.
- Profile posts page, new Reddit: `https://www.reddit.com/user/<name>/submitted/` (verified by the owner).
- A post page's own `shreddit-post` carries `view-context="CommentsPage"` (listings use `SubredditFeed` or `AggregateFeed`). This is a second signal for "this is a post's own page"; the URL rule stays primary.
- Search URL: assumed `/search/?q=...`. Search results are deliberately not blocked (owner decision during Task 14), so no markup was captured. The adapters' `isSearchPage` (`/search` and `/r/<sub>/search`) makes the blocker treat search like a post page: nothing is hidden or restored while on it, and leaving rescans.

## Navigation

- `window.navigation` exists on new Reddit, so the Navigation API (`currentchange`) can be used in Task 12.
- Verified with a `window.__probe` marker: clicking a text post from a new-Reddit listing does **not** reload the page (the marker survived), so listing → post navigation is client-side, the URL changes, and the content script stays alive. The extension must detect it by URL change (`navigation` `currentchange`, with `popstate` and an interval fallback).
- Outbound link posts: clicking the **preview image** opens the external site in a **new tab**. Clicking the **title** does **not** reload the page (the marker survived), so it is also client-side navigation within Reddit. Verified by the owner: it lands on the post's own page, e.g. `https://www.reddit.com/r/xmen/comments/1xityzs/patrick_stewart_star_trek_captain_and_xmen/` (consistent with `pdp-target="_self"`). The URL changes without a reload, which the extension handles through URL-change detection, and the post-page rule applies.

## Theme signal

- New Reddit dark: `html` has the class `theme-dark` (seen together with `theme-beta`); computed `color-scheme` on `html` is `dark`. The computed `body` background is `rgba(0, 0, 0, 0)` (transparent), so a body-background luminance fallback does **not** work on new Reddit; use the `html` computed `color-scheme` instead.
- New Reddit light: `html` has the class `theme-light` (with `theme-beta`), and computed `color-scheme` on `html` is `light`. Captured with Reddit set to light while the OS was dark (`osDark: true`), so the signal follows Reddit's own setting, not the OS. Rule: `theme-dark` → dark, `theme-light` → light; fall back to computed `color-scheme` if neither class is present.
- Old Reddit: no theme class; always light unless RES night mode is on (RES was loaded but the page was light).

## Initial render

`<shreddit-post` is present in the server-rendered HTML on both a post page and a subreddit listing (verified in "View page source"; the listing's first post is already in the HTML with `content-href` and `id` set). So blocked posts exist in the first HTML Reddit sends, and a cold page load can paint them before the content script hides them. The flash is measured live in Task 14.

RES is installed on purpose but is in maintenance-only mode and no longer works fully. It adds `res-*` classes and, on old Reddit, extra markup inside `.thing` entries (such as `.RESUserTag`). Test with it on, since that is the owner's setup, but nothing in the design depends on it.

## M1 verification

Run by the owner in their own Chrome with `extension/` loaded unpacked (the automation browser cannot open reddit.com or `chrome://extensions`), blocking `thedailybeast.com` and `newsweek.com`. Results are reported by the owner; DevTools attribute edits were done on a live post.

| Spec item | Result |
|---|---|
| 1 Hide in place: home feed, subreddit listing, profile `/submitted`, new and old Reddit; a post's own page hides nothing | Pass |
| 1 Search results | Not a supported page type. Search results were not hidden and no outbound link was found in their markup; the owner decided search results should stay visible, so SPEC.md, README.md and the plan were changed to say so |
| 2 Matching, new Reddit (`content-href` edited): `www.newsweek.com`, `sub.newsweek.com` hidden; `notnewsweek.com`, `newsweek.com.evil.com`, `/r/news/comments/abc/x/`, `javascript:alert(1)`, `https://example.org/x` not hidden | Pass (all 7) |
| 2 Matching, old Reddit (`data-url` edited): same 7 cases | Pass (all 7) |
| 3 Infinite scroll hides new posts | Pass |
| 4 Adding a domain hides posts in all open tabs, no reload | Pass |
| 5 Show post reveals one post; Unblock domain restores in every tab | Pass |
| 14 DevTools: the hidden post is still in the page, marked `data-rdb-hidden` on the `shreddit-post` element (the `article` wrapper is not marked and has no `aria-label`); the stub is a sibling inserted before it | Pass (owner pasted the element) |
| 9 Theme: new Reddit stub dark, old Reddit stub light (screenshots); switch opposite to OS | Switch opposite to OS: owner reported pass |
| 12 Overlay above a listing | Not applicable: new Reddit opens a post in the same tab with no overlay (M0). Replaced by a navigation check below |
| 12 Navigation, new Reddit: listing -> post page -> Back (client-side) | Pass: a post's own page shows no stubs (it has an ad and comments, no related-posts feed); after Back the listing shows its stubs again, not doubled |
| 12 A post revealed with Show post, opened, then Back | Still revealed after Back (revealed state lasts for the page load, as designed) |
| Flash (spec 4.2): blocked posts painting before they are hidden, cold load and infinite scroll | Owner reported no flash. The pre-paint step in 4.2 is not needed for M1 |
| Show post / Hide post: click and Enter on a focused button | Pass: shows and hides the entry, never opens the post or the page |
| Console, new Reddit listing (screenshot) | Only Reddit's own messages: report-only CSP notices for its inline handlers (`ss-content.js`), preload and deprecated-meta warnings. Nothing from `content.js` or `chrome-extension://`. The 261 "errors" in the issues counter were not itemized; filtering the console by `chrome-extension` came back empty, so none are ours |

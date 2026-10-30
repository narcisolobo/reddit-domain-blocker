# Reddit Domain Blocker

A Chrome extension that hides Reddit posts by the domain they link to.

Say a few outlets flood your feed with clickbait. Add their domains once, and their posts disappear from Reddit. Each hidden post leaves a small stub ("Hidden: example.com") so you know the extension is working, and you can still peek at the post.

> **Status: complete.** Every milestone (M0–M4) is built and has been checked by hand on new and old Reddit; the results are in [NOTES.md](NOTES.md). The one open item is a run with a Windows screen reader (NVDA or JAWS). VoiceOver on macOS has been checked.

## What it does

- Hides posts whose link domain is on your list. Blocking `example.com` also blocks `news.example.com`, but not `notexample.com`.
- Works on old.reddit.com and new Reddit, including posts that load as you scroll, with no visible flash before they hide.
- Hides posts in the home feed, subreddits, and user profiles. Search results and a post you open on its own page are left alone.
- Shows a stub in place of each hidden post, with **Show post** and **Unblock domain** buttons. The stub matches Reddit's light or dark theme.
- Manages the list on an options page: paste a domain or a full URL and it is cleaned up to a bare hostname. Removing a domain archives it, so you can restore it later, or delete it permanently with a second confirming click. Each domain shows how many posts it has hidden.
- Adds a **Block this domain** entry to the right-click menu on links, on Reddit only.
- Syncs the list through your Chrome account, and updates every open Reddit tab right away.
- Exports and imports the list as JSON, with dates and counts. Importing over an existing list lets you keep the larger count or add the two together.
- Meets WCAG 2.2 AA on the options page and the stub: full keyboard use, screen-reader names and announcements, forced-colors support, and icon-only buttons with tooltips at 412px wide and narrower.

## Using it

Click the extension's toolbar icon to open the options page, type a domain or paste a link, and press **Add**. On Reddit, you can also right-click an outgoing link and choose **Block this domain**.

## Privacy

The extension makes no network requests, collects nothing, and loads no remote code. Your list lives in Chrome's own storage (`chrome.storage.sync`), and hidden-post counts stay on your device.

## Project layout

| File | What it is |
| --- | --- |
| [SPEC.md](SPEC.md) | The full design: behavior, data model, options page, accessibility, and build milestones |
| [NOTES.md](NOTES.md) | Findings from live Reddit, design calls made along the way, and each milestone's manual verification |
| [src/](src/) | Source: `background/` (service worker, storage, right-click menu), `content/` (finds and hides posts, the stub), `options/` (options page), `shared/` (domain cleanup, records, import and export) |
| [extension/](extension/) | The loadable extension. `manifest.json`, `options.html` and `options.css` live here; the build writes the bundled scripts next to them |
| [test/](test/) | Node test suite, run in jsdom, including contrast and axe-core checks |
| [scripts/](scripts/) | The esbuild build and two icon generators: Tabler glyphs for the UI (`gen-icons`) and the extension icon PNGs (`gen-app-icons`) |
| [LICENSE](LICENSE) | MIT license |

## Building and installing

```
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the `extension/` folder. Run the tests with `npm test`.

## License

[MIT](LICENSE). Bundled [Tabler Icons](https://tabler.io/icons) are also MIT-licensed, and their notice ships with the extension in `THIRD_PARTY_LICENSES`.

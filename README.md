# Reddit Domain Blocker

A Chrome extension that hides Reddit posts by the domain they link to.

Say a few outlets flood your feed with clickbait. Add their domains once, and their posts disappear from Reddit. Each hidden post leaves a small stub ("Hidden: example.com") so you know the extension is working, and you can still peek at the post.

> **Status: M1 is implemented and loadable.** Build with `npm install && npm run build`, then load `extension/` unpacked. It has been checked by hand on new and old Reddit; see `NOTES.md` for the results. Adding a domain, the archive section, the context menu, and import/export are still to come (M2 onward). The full design is in [SPEC.md](SPEC.md).

## What it will do

- Hide posts whose link domain is on your list. Blocking `example.com` also blocks `news.example.com`, but not `notexample.com`.
- Work on old.reddit.com and new Reddit, including posts that load as you scroll.
- Hide posts in the home feed, subreddits, and user profiles. Search results and a post you open on its own page are left alone.
- Show a stub in place of each hidden post, with **Show post** and **Unblock domain** buttons. The stub matches Reddit's light or dark theme.
- Let you manage the list on an options page: paste a domain or a full URL and it is cleaned up to a bare hostname. Removing a domain archives it, so you can restore it later. Each domain shows how many posts it has hidden.
- Add a **Block this domain** entry to the right-click menu on links, on Reddit only.
- Sync the list through your Chrome account, and update every open Reddit tab right away.
- Export and import the list as JSON, with dates and counts.
- Meet WCAG 2.2 AA on the options page and the stub.

## Privacy

The extension makes no network requests, collects nothing, and loads no remote code. Your list lives in Chrome's own storage (`chrome.storage.sync`), and hidden-post counts stay on your device.

## Project layout

| File | What it is |
| --- | --- |
| [SPEC.md](SPEC.md) | The full design: behavior, data model, options page, accessibility, and build milestones |
| [LICENSE](LICENSE) | MIT license |

## Building and installing

```
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the `extension/` folder. Run the tests with `npm test`.

## License

[MIT](LICENSE). Bundled [Tabler Icons](https://tabler.io/icons) are also MIT-licensed, and their notice will ship with the extension.

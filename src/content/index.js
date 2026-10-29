import { pickAdapter } from "./adapters.js";
import { createBlocker } from "./blocker.js";
import { activeDomains, recordsFromItems } from "../shared/records.js";

const POLL_MS = 500;

async function readDomains(chrome) {
  const items = await chrome.storage.sync.get(null);
  return activeDomains(recordsFromItems(items));
}

function makeRequestUnblock(chrome) {
  return async (domain) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "domain/archive", domain });
      if (response && typeof response === "object" && typeof response.ok === "boolean") {
        return response;
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  };
}

export async function init({ chrome, document, location, window }) {
  const blocker = createBlocker({
    document,
    adapter: pickAdapter(location.hostname),
    getUrl: () => location.href,
    requestUnblock: makeRequestUnblock(chrome),
  });

  let latestRead = 0;
  async function refresh() {
    const seq = ++latestRead;
    try {
      const domains = await readDomains(chrome);
      if (seq === latestRead) blocker.setActiveDomains(domains);
    } catch {
      // Keep the previous list; the context may be invalidated.
    }
  }

  try {
    blocker.setActiveDomains(await readDomains(chrome));
  } catch {
    // Start with an empty list.
  }
  blocker.start();

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      try {
        refresh();
      } catch {
        // Ignore.
      }
    });
  } catch {
    // Ignore.
  }

  let lastHref = location.href;
  const onUrl = () => {
    lastHref = location.href;
    blocker.handleUrlChange();
  };
  const onUrlIfChanged = () => {
    if (location.href !== lastHref) onUrl();
  };
  window.addEventListener("popstate", onUrl);
  if (window.navigation) {
    window.navigation.addEventListener("currentchange", onUrlIfChanged);
  } else {
    window.setInterval(onUrlIfChanged, POLL_MS);
  }

  return blocker;
}

if (globalThis.chrome?.runtime?.id) {
  init({ chrome: globalThis.chrome, document, location, window });
}

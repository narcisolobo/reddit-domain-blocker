import { handleMessage } from "./blocklist.js";

export function init(chromeApi) {
  // Serialize message handling: blocklist operations read then write, so
  // they must not interleave across awaits.
  let queue = Promise.resolve();

  chromeApi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    queue = queue
      .then(() => handleMessage(msg, { sync: chromeApi.storage.sync, local: chromeApi.storage.local }))
      .then(
        (res) => sendResponse(res),
        () => sendResponse({ ok: false, reason: "error" }),
      )
      .catch(() => {});
    return true;
  });

  chromeApi.action.onClicked.addListener(() => {
    chromeApi.runtime.openOptionsPage();
  });
}

if (typeof globalThis.chrome !== "undefined") {
  init(globalThis.chrome);
}

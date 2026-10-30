import { addDomain, handleMessage } from "./blocklist.js";
import { MENU_ID, registerMenu, menuNoticeFor } from "./menu.js";

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

  chromeApi.runtime.onInstalled.addListener(() => registerMenu(chromeApi.contextMenus).catch(() => {}));

  chromeApi.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !(tab?.id >= 0)) return Promise.resolve();
    const run = queue.then(async () => {
      const result = await addDomain(chromeApi.storage.sync, info.linkUrl, "context-menu");
      const notice = menuNoticeFor(result);
      if (notice) {
        await chromeApi.tabs.sendMessage(tab.id, { type: "notice", ...notice }).catch(() => {});
      }
    });
    queue = run.catch(() => {});
    return run.catch(() => {});
  });

  chromeApi.action.onClicked.addListener(() => {
    chromeApi.runtime.openOptionsPage();
  });
}

if (typeof globalThis.chrome !== "undefined") {
  init(globalThis.chrome);
}

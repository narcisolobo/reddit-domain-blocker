import { itemBytes } from "../../src/shared/transfer.js";

// NOTE: onChanged fires synchronously inside set()/remove() and also for writes
// that change nothing. Real Chrome fires it asynchronously and only for keys
// whose value changed, so tests must not depend on that ordering.
function createArea(name, onChanged) {
  let data = {};
  let nextSetError = null;
  let bytesOverride = null;

  const pick = (keys) => {
    if (keys == null) return { ...data };
    const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
    return out;
  };

  return {
    async get(keys) {
      return structuredClone(pick(keys));
    },
    async set(obj) {
      if (nextSetError) {
        const err = nextSetError;
        nextSetError = null;
        throw err;
      }
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      onChanged(changes, name);
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      const changes = {};
      for (const k of list) {
        if (!(k in data)) continue;
        changes[k] = { oldValue: data[k], newValue: undefined };
        delete data[k];
      }
      if (Object.keys(changes).length) onChanged(changes, name);
    },
    async getBytesInUse(keys) {
      if (bytesOverride !== null) return bytesOverride;
      const items = pick(keys);
      return Object.entries(items).reduce((sum, [k, v]) => sum + itemBytes(k, v), 0);
    },
    overrideBytesInUse(n) {
      bytesOverride = n;
    },
    failNextSet(error) {
      nextSetError = error;
    },
  };
}

export function createFakeChrome() {
  const changeListeners = [];
  const emitChanged = (changes, area) => {
    for (const fn of changeListeners) fn(changes, area);
  };

  let messageHandler = null;
  let invalidated = false;
  const messageListeners = [];
  const clickListeners = [];
  const menuClickListeners = [];
  const installListeners = [];
  const menuItems = [];
  const sent = [];
  let nextSendError = null;

  const openOptionsPage = () => {
    openOptionsPage.calls += 1;
  };
  openOptionsPage.calls = 0;

  const fake = {
    storage: {
      sync: createArea("sync", emitChanged),
      local: createArea("local", emitChanged),
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: {
      id: "fake-extension-id",
      async sendMessage(msg) {
        if (invalidated) throw new Error("Extension context invalidated.");
        if (!messageHandler) return undefined;
        return messageHandler(msg);
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onInstalled: { addListener: (fn) => installListeners.push(fn) },
      install() {
        return Promise.all(installListeners.map((fn) => fn({ reason: "install" })));
      },
      openOptionsPage,
      setMessageHandler(fn) {
        messageHandler = fn;
      },
      invalidate() {
        invalidated = true;
      },
      // Mimics Chrome: a listener returning true will call sendResponse later.
      dispatchMessage(msg) {
        return new Promise((resolve) => {
          let answered = false;
          const sendResponse = (value) => {
            answered = true;
            resolve(value);
          };
          let willRespond = false;
          for (const fn of messageListeners) {
            if (fn(msg, {}, sendResponse) === true) willRespond = true;
          }
          if (!willRespond && !answered) resolve(undefined);
        });
      },
    },
    contextMenus: {
      items: menuItems,
      create(props) {
        menuItems.push(props);
      },
      removeAll() {
        menuItems.length = 0;
      },
      onClicked: { addListener: (fn) => menuClickListeners.push(fn) },
      click(info, tab) {
        return Promise.all(menuClickListeners.map((fn) => fn(info, tab)));
      },
    },
    tabs: {
      sent,
      async sendMessage(tabId, msg) {
        if (nextSendError) {
          const err = nextSendError;
          nextSendError = null;
          throw err;
        }
        sent.push({ tabId, msg });
      },
      failNextSend(err) {
        nextSendError = err;
      },
    },
    action: {
      onClicked: { addListener: (fn) => clickListeners.push(fn) },
      click() {
        for (const fn of clickListeners) fn({});
      },
    },
  };
  return fake;
}

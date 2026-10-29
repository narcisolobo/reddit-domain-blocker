function createArea(name, onChanged) {
  let data = {};
  let nextSetError = null;

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
    action: {
      onClicked: { addListener: (fn) => clickListeners.push(fn) },
      click() {
        for (const fn of clickListeners) fn({});
      },
    },
  };
  return fake;
}

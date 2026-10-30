// Batches "a post was hidden" events into one stats/hits message per window.
// The first add of a batch starts the timer; later adds do not reset it.
export function createHitBatcher({ send, delayMs = 500, timers }) {
  let pending = new Map();
  let timer = null;

  function flush() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const hits = Object.fromEntries(pending);
    pending = new Map();
    try {
      Promise.resolve(send({ type: "stats/hits", hits })).catch(() => {});
    } catch {
      // The extension context may be gone; counts are best-effort.
    }
  }

  function add(domain) {
    pending.set(domain, (pending.get(domain) || 0) + 1);
    if (timer === null) timer = timers.setTimeout(flush, delayMs);
  }

  return { add, flush };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHitBatcher } from "../src/content/hits.js";

function fakeTimers() {
  const calls = [];
  const cleared = [];
  return {
    calls,
    cleared,
    setTimeout(fn, ms) {
      calls.push({ fn, ms });
      return calls.length;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
    fire(i = calls.length - 1) {
      calls[i].fn();
    },
  };
}

test("adds within the window become one message with summed counts", () => {
  const timers = fakeTimers();
  const sent = [];
  const b = createHitBatcher({ send: (m) => sent.push(m), timers });
  b.add("a.com");
  b.add("a.com");
  b.add("b.com");
  assert.equal(sent.length, 0);
  assert.equal(timers.calls[0].ms, 500);
  timers.fire();
  assert.deepEqual(sent, [{ type: "stats/hits", hits: { "a.com": 2, "b.com": 1 } }]);
});

test("the timer is not reset by later adds", () => {
  const timers = fakeTimers();
  const b = createHitBatcher({ send: () => {}, timers });
  b.add("a.com");
  b.add("b.com");
  b.add("a.com");
  assert.equal(timers.calls.length, 1);
  assert.equal(timers.cleared.length, 0);
  timers.fire();
  b.add("a.com");
  assert.equal(timers.calls.length, 2, "a new batch starts a new timer");
});

test("flush with nothing pending sends nothing", () => {
  const timers = fakeTimers();
  const sent = [];
  const b = createHitBatcher({ send: (m) => sent.push(m), timers });
  b.flush();
  assert.equal(sent.length, 0);
  b.add("a.com");
  b.flush();
  b.flush();
  assert.equal(sent.length, 1);
  assert.equal(timers.cleared.length, 1, "flush clears the pending timer");
});

test("a rejected send is swallowed and the next batch still sends", async () => {
  const timers = fakeTimers();
  const sent = [];
  let fail = true;
  const b = createHitBatcher({
    send: (m) => {
      sent.push(m);
      return fail ? Promise.reject(new Error("no receiver")) : Promise.resolve();
    },
    timers,
  });
  b.add("a.com");
  b.flush();
  await new Promise((r) => setTimeout(r, 0));
  fail = false;
  b.add("b.com");
  b.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].hits, { "b.com": 1 });
});

test("a send that throws synchronously is swallowed", () => {
  const timers = fakeTimers();
  const sent = [];
  let boom = true;
  const b = createHitBatcher({
    send: (m) => {
      sent.push(m);
      if (boom) throw new Error("context invalidated");
    },
    timers,
  });
  b.add("a.com");
  assert.doesNotThrow(() => timers.fire());
  boom = false;
  b.add("b.com");
  b.flush();
  assert.equal(sent.length, 2);
});

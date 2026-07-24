"use strict";

class FakeClock {
  constructor(now = 0) {
    this.nowMs = now;
    this.nextId = 1;
    this.timers = new Map();
  }

  adapter() {
    return {
      now: () => this.nowMs,
      setTimeout: (fn, delay) => this.setTimeout(fn, delay),
      clearTimeout: (id) => this.clearTimeout(id),
    };
  }

  setTimeout(fn, delay = 0) {
    const id = this.nextId++;
    this.timers.set(id, {
      at: this.nowMs + Math.max(0, Number(delay) || 0),
      fn,
    });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  async advance(ms) {
    const target = this.nowMs + ms;
    while (true) {
      let nextId = null;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextId = id;
          nextAt = timer.at;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      this.nowMs = timer.at;
      timer.fn();
      await flushMicrotasks();
    }
    this.nowMs = target;
    await flushMicrotasks();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function textResponse(text, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        const key = Object.keys(headers).find(
          (candidate) => candidate.toLowerCase() === name.toLowerCase(),
        );
        return key ? headers[key] : null;
      },
    },
    text: async () => text,
  };
}

module.exports = {
  FakeClock,
  deferred,
  flushMicrotasks,
  textResponse,
};

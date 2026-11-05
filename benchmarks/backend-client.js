const { spawn } = require("node:child_process");
const readline = require("node:readline");

function startBackend(binary, args, { readyTimeoutMs = 20000, requestTimeoutMs = 15000 } = {}) {
  const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  const readinessWaiters = [];
  let readyMessage = null;
  let failure = null;
  let nextId = 0;

  const fail = (error) => {
    failure = error;
    child.kill();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    for (const waiter of readinessWaiters.splice(0)) waiter.reject(error);
  };

  child.stdin.on("error", (error) => fail(new Error(`backend stdin failed: ${error.message}`)));
  child.stderr.resume();
  child.once("error", (error) => fail(error));
  child.once("exit", (code, signal) => fail(new Error(`backend exited (${signal || code})`)));

  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "ready") {
      if (!message.ok) {
        fail(new Error(message.error || "backend failed to start"));
        return;
      }
      readyMessage = message;
      for (const waiter of readinessWaiters.splice(0)) waiter.resolve(message);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    request.resolve(message);
  });

  return {
    get readyMessage() { return readyMessage; },
    waitReady() {
      if (readyMessage) return Promise.resolve(readyMessage);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = readinessWaiters.findIndex((waiter) => waiter.reject === reject);
          if (index >= 0) readinessWaiters.splice(index, 1);
          reject(new Error(`backend did not become ready within ${readyTimeoutMs} ms`));
        }, readyTimeoutMs);
        readinessWaiters.push({
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
      });
    },
    request(method, params = {}) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${requestTimeoutMs} ms`));
        }, requestTimeoutMs);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        try {
          child.stdin.write(`${JSON.stringify({ id, method, ...params })}\n`);
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          fail(error);
          reject(error);
        }
      });
    },
    stop() {
      try { child.stdin.write(`${JSON.stringify({ id: 0, method: "shutdown" })}\n`); } catch { /* closed */ }
      child.stdin.end();
      child.kill();
    },
  };
}

module.exports = { startBackend };

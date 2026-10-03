// Simulated Playwright for the preview host in fixture mode (M07). tests/fixtures/fake-wsl.mjs writes a wrapper module into the
// simulated distro (/home/runner/tools/pw/node_modules/playwright) that requires this file with the fake-wsl state file. No
// Chromium and no namespace: goto fetches the preview over loopback (a real HTTP request to the fixture's preview), the other
// steps are simulated. Behaviour from the state file, key "fakeBrowser":
//   launchFails   the launch throws (infrastructure: BLOCKED, never a product failure)
//   failText      an expectText whose text contains it times out (a product FAIL)
//   hang          every expectText waits until the browser is closed (Stop / Pause → INTERRUPTED)
//   consoleError  a console error after each goto
//   sandbox       what ifrimFakeSandbox() reports to the host (default { simulated: true }): e.g. { active: false, reason }
// Every launch is logged (options only) to <state dir>/fake-browser.log, so tests can check the Chromium sandbox flag.
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = (stateFile) => {
  const state = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")).fakeBrowser || {}; } catch { return {}; } };
  const log = (entry) => { try { fs.appendFileSync(path.join(path.dirname(stateFile), "fake-browser.log"), `${JSON.stringify({ at: Date.now(), ...entry })}\n`); } catch { /* best effort */ } };
  // A 1×1 PNG header (the Hub checks the signature before it writes the evidence file).
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

  async function launch(options = {}) {
    const st = state();
    log({ launch: { chromiumSandbox: options.chromiumSandbox, headless: options.headless, args: options.args || [] } });
    if (st.launchFails) throw new Error("browserType.launch: Executable doesn't exist (simulated)");
    let closed = false;
    const pending = new Set();
    const hang = () => new Promise((_, reject) => pending.add(reject));
    const browser = {
      isConnected: () => !closed,
      close: async () => {
        if (closed) return;
        closed = true;
        for (const reject of pending) reject(new Error("Target page, context or browser has been closed"));
        pending.clear();
        log({ closed: true });
      },
      ifrimFakeSandbox: () => st.sandbox || { simulated: true, active: false },
      newContext: async () => {
        const listeners = {};
        let url = "about:blank";
        const page = {
          on: (event, fn) => { (listeners[event] ||= []).push(fn); },
          url: () => url,
          goto: async (target, { timeout = 10000 } = {}) => {
            if (closed) throw new Error("Target page, context or browser has been closed");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
              const res = await fetch(target, { signal: controller.signal, redirect: "manual" });
              await res.text();
              url = target;
              if (st.consoleError) for (const fn of listeners.console || []) fn({ type: () => "error", text: () => String(st.consoleError) });
              return { status: () => res.status };
            } catch { throw new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${target}`); }
            finally { clearTimeout(timer); }
          },
          setViewportSize: async () => {},
          fill: async () => {},
          selectOption: async () => {},
          click: async () => {},
          waitForSelector: async () => {},
          waitForFunction: async (fn, needle, { timeout = 10000 } = {}) => {
            if (st.hang) return hang();
            if (st.failText && String(needle).includes(st.failText)) {
              await new Promise((r) => setTimeout(r, Math.min(timeout, 200)));
              throw new Error(`page.waitForFunction: Timeout ${timeout}ms exceeded.`);
            }
            return true;
          },
          evaluate: async () => ({ scroll: 390, view: 390 }),
          screenshot: async () => PNG,
          title: async () => "",
        };
        return { route: async () => {}, routeWebSocket: async () => {}, newPage: async () => page, close: async () => {} };
      },
    };
    return browser;
  }
  return { chromium: { launch } };
};

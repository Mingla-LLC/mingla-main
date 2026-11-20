// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4517 tester adversarial suite: races the implementor's suite does not cover.
//
// Attacks the push opt-in gate declared in issue_4517_push_optin_gate.implementor.test.ts.
//
// Angle: the OS prompt is answered WHILE OneSignal.login is still in flight, a
// login fails then retries, the permission read throws, and a user switch
// (A, logout, B, logout, A) happens while an earlier login is still pending.
//
// The mock models the iOS SDK 5.8 states more strictly than the implementor's:
// "notDetermined" -> "prompting" (OS dialog on screen, canRequestPermission still
// true because answeredPrompt is false) -> "granted" | "denied". optIn() on
// notDetermined shows the OS prompt; optIn() while prompting or denied shows the
// false "Open Settings" alert (the bug). Every login and every requestPermission
// is a manually-resolved deferred so the test chooses the interleaving.
//
// FAILS-ON-REVERT: restoring the unconditional optIn() in runLogin fails every
// case below (prompt or alert counted); deleting the `granted === true` optIn in
// requestPushPermission fails "Allow while login is mid-read".

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const eq = (a: unknown, b: unknown, label: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const toData = (code: string): string => {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "data:application/typescript;base64," + btoa(bin);
};

const SDK_STUB = toData(
  `export const OneSignal = new Proxy({}, { get: (_t, k) => globalThis.__os4517t.sdk[k] });
   export const LogLevel = { Verbose: 0 };`,
);
const LOGGER_STUB = toData(`export const logger = { push() {} };`);
const SERVICE_URL = new URL("../oneSignalService.ts", import.meta.url);
let nonce = 0;

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function harness(state: "notDetermined" | "granted" | "denied", opts: { readThrows?: boolean } = {}) {
  globalThis.__DEV__ = false;
  const dev = {
    state, optIns: 0, prompts: 0, alerts: 0,
    logins: [] as { userId: string; d: ReturnType<typeof deferred> }[],
    permissionAnswer: null as null | ReturnType<typeof deferred<boolean>>,
  };
  const optIn = () => {
    dev.optIns++;
    if (dev.state === "notDetermined") { dev.prompts++; dev.state = "prompting"; }
    else if (dev.state !== "granted") dev.alerts++;
  };
  globalThis.__os4517t = {
    sdk: {
      Debug: { setLogLevel() {} },
      initialize() {},
      InAppMessages: { setPaused() {} },
      login: (userId: string) => {
        const d = deferred();
        dev.logins.push({ userId, d });
        return d.promise;
      },
      logout() {},
      User: { addTag() {}, pushSubscription: { optIn } },
      Notifications: {
        canRequestPermission: async () => {
          if (opts.readThrows) throw new Error("bridge read failed");
          return dev.state === "notDetermined" || dev.state === "prompting";
        },
        getPermissionAsync: async () => {
          if (opts.readThrows) throw new Error("bridge read failed");
          return dev.state === "granted";
        },
        requestPermission: (fallback: boolean) => {
          assert(fallback === false, "requestPermission must never pass fallbackToSettings=true");
          if (dev.state === "granted") return Promise.resolve(true);
          if (dev.state === "denied") return Promise.resolve(false);
          dev.state = "prompting";
          dev.prompts++;
          dev.permissionAnswer = deferred<boolean>();
          return dev.permissionAnswer.promise;
        },
        clearAll() {}, addEventListener() {}, removeEventListener() {},
      },
    },
  };
  const source = Deno.readTextFileSync(SERVICE_URL)
    .replace("from 'react-native-onesignal'", `from "${SDK_STUB}"`)
    .replace("from '../utils/logger'", `from "${LOGGER_STUB}"`);
  assert(source.includes(SDK_STUB) && source.includes(LOGGER_STUB), "both service imports must be stubbed");
  const svc = await import(toData(`${source}\n// tester load ${nonce++}`));
  svc.initializeOneSignal();
  const answer = (allow: boolean) => {
    dev.state = allow ? "granted" : "denied";
    dev.permissionAnswer!.resolve(allow);
  };
  return { svc, dev, answer };
}

Deno.test("#4517 tester: Allow tapped while OneSignal.login is in flight = exactly 1 optIn, 0 alerts", async () => {
  const h = await harness("notDetermined");
  const login = h.svc.loginToOneSignal("u1");
  const ask = h.svc.requestPushPermission();
  await flush();
  eq(h.dev.prompts, 1, "one OS prompt, from requestPermission");
  h.answer(true); // Allow before login resolves
  assert((await ask) === true, "grant resolves true");
  eq(h.dev.optIns, 0, "no optIn while nobody is logged in");
  h.dev.logins[0].d.resolve();
  await login;
  eq([h.dev.optIns, h.dev.prompts, h.dev.alerts], [1, 1, 0], "login after the grant opts in once");
});

Deno.test("#4517 tester: Allow tapped after login read the mid-prompt state = exactly 1 optIn, 0 alerts", async () => {
  const h = await harness("notDetermined");
  const ask = h.svc.requestPushPermission();
  await flush();
  const login = h.svc.loginToOneSignal("u1");
  await flush();
  h.dev.logins[0].d.resolve();
  await login; // reads "prompting": canRequest true, not granted -> must not optIn
  eq([h.dev.optIns, h.dev.alerts], [0, 0], "mid-prompt login must not optIn (would raise the false alert)");
  h.answer(true);
  await ask;
  eq([h.dev.optIns, h.dev.prompts, h.dev.alerts], [1, 1, 0], "the grant opts in once");
  await h.svc.loginToOneSignal("u1"); // the later pair of effect runs
  eq(h.dev.optIns, 1, "a repeat login does not opt in again");
});

Deno.test("#4517 tester: Don't Allow during login flight, then 3 more logins = 0 optIn, 0 alerts", async () => {
  const h = await harness("notDetermined");
  const login = h.svc.loginToOneSignal("u1");
  const ask = h.svc.requestPushPermission();
  await flush();
  h.answer(false);
  assert((await ask) === false, "decline resolves false");
  h.dev.logins[0].d.resolve();
  await login;
  for (let i = 0; i < 3; i++) await h.svc.loginToOneSignal("u1");
  eq([h.dev.optIns, h.dev.alerts], [0, 0], "decliner is never opted in or alerted");
});

Deno.test("#4517 tester: a failed login does not poison the retry; a granted retry opts in once", async () => {
  const h = await harness("granted");
  const first = h.svc.loginToOneSignal("u1");
  await flush();
  h.dev.logins[0].d.reject(new Error("network"));
  await first; // never throws
  eq(h.dev.optIns, 0, "no optIn on a failed login");
  const retry = h.svc.loginToOneSignal("u1");
  assert(retry !== first, "a failed flight is not replayed");
  await flush();
  eq(h.dev.logins.length, 2, "the retry calls OneSignal.login again");
  h.dev.logins[1].d.resolve();
  await retry;
  eq([h.dev.optIns, h.dev.alerts], [1, 0], "retry opts in once");
});

Deno.test("#4517 tester: permission read throws = treated as unknown, 0 optIn, 0 alerts", async () => {
  const h = await harness("denied", { readThrows: true });
  const p = h.svc.loginToOneSignal("u1");
  await flush();
  h.dev.logins[0].d.resolve();
  await p;
  eq([h.dev.optIns, h.dev.alerts], [0, 0], "a failed read never falls through to optIn");
});

Deno.test("#4517 tester: user switch A, logout, B, logout, A with stale A still in flight on a declined device = 0 alerts", async () => {
  const h = await harness("denied");
  const a1 = h.svc.loginToOneSignal("A");
  h.svc.logoutOneSignal();
  const b = h.svc.loginToOneSignal("B");
  h.svc.logoutOneSignal();
  const a2 = h.svc.loginToOneSignal("A");
  assert(a2 !== a1, "after logout, A's login runs again rather than reusing the stale flight");
  await flush();
  // resolve out of order: newest first, stale A last
  h.dev.logins[2].d.resolve();
  h.dev.logins[1].d.resolve();
  h.dev.logins[0].d.resolve();
  await Promise.all([a1, b, a2]);
  eq([h.dev.optIns, h.dev.alerts], [0, 0], "no optIn on a declined device whatever the order");
  const ask = await h.svc.requestPushPermission(); // denied: OS returns false without a dialog
  eq([ask, h.dev.optIns, h.dev.alerts], [false, 0, 0], "a denied request never opts in");
});

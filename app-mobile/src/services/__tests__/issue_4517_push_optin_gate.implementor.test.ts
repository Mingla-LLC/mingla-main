// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4517 — Explorer false "notifications turned off" alert after Allow.
//
// MINGLA-INVARIANT: push optIn never runs on an unanswered or denied permission.
//
// The SDK rule modelled by the mock (OneSignal iOS 5.8): pushSubscription.optIn()
// raises the OS prompt when the user was never asked, and raises the Settings
// alert when they were asked and are not granted. Our code must never call it in
// those states, however many times the sign-in effect fires (device proof: four
// loginToOneSignal calls per cold start).
//
// Loads the REAL oneSignalService.ts: its two imports (the SDK and the logger)
// are rewritten to data: stub modules, and the file is imported as a data: URL,
// so the suite needs read access only and no React Native runtime.
//
// FAILS-ON-REVERT: restoring the unconditional optIn() in runLogin fails the
// never-asked and declined cases; deleting the _loginFlight guard fails the
// granted case; not clearing it in logoutOneSignal fails the logout case.

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
  `export const OneSignal = new Proxy({}, { get: (_t, k) => globalThis.__os4517.sdk[k] });
   export const LogLevel = { Verbose: 0 };`,
);
const LOGGER_STUB = toData(`export const logger = { push() {} };`);

const SERVICE_URL = new URL("../oneSignalService.ts", import.meta.url);
let nonce = 0;

async function harness(init: { prompted: boolean; granted: boolean }) {
  globalThis.__DEV__ = false;
  const dev = { ...init, optIns: 0, prompts: 0, alerts: 0 };
  const optIn = () => {
    dev.optIns++;
    if (!dev.prompted) { dev.prompts++; dev.prompted = true; }
    else if (!dev.granted) dev.alerts++;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  globalThis.__os4517 = {
    sdk: {
      Debug: { setLogLevel() {} },
      initialize() {},
      InAppMessages: { setPaused() {} },
      login: async () => { await tick(); },
      logout() {},
      User: { addTag() {}, pushSubscription: { optIn } },
      Notifications: {
        canRequestPermission: async () => !dev.prompted,
        getPermissionAsync: async () => dev.granted,
        requestPermission: async () => {
          if (dev.prompted) return dev.granted;
          dev.prompted = true; dev.prompts++; dev.granted = true;
          return true;
        },
        clearAll() {}, addEventListener() {}, removeEventListener() {},
      },
    },
  };
  const source = Deno.readTextFileSync(SERVICE_URL)
    .replace("from 'react-native-onesignal'", `from "${SDK_STUB}"`)
    .replace("from '../utils/logger'", `from "${LOGGER_STUB}"`);
  assert(source.includes(SDK_STUB) && source.includes(LOGGER_STUB), "both service imports must be stubbed");
  const svc = await import(toData(`${source}\n// load ${nonce++}`));
  svc.initializeOneSignal();
  return { svc, dev };
}

Deno.test("#4517 never-asked device: login = 0 optIn / prompt / alert; a grant = exactly 1 optIn", async () => {
  const h = await harness({ prompted: false, granted: false });
  await h.svc.loginToOneSignal("u1");
  eq([h.dev.optIns, h.dev.prompts, h.dev.alerts], [0, 0, 0], "login on a never-asked device");
  assert((await h.svc.requestPushPermission()) === true, "the grant resolves true");
  eq(h.dev.optIns, 1, "optIn after the grant");
  eq(h.dev.alerts, 0, "alerts");
  eq(h.dev.prompts, 1, "the single OS prompt comes from requestPermission");
});

Deno.test("#4517 declined device: four sequential + concurrent logins = 0 optIn, 0 alerts", async () => {
  const h = await harness({ prompted: true, granted: false });
  await Promise.all([h.svc.loginToOneSignal("u1"), h.svc.loginToOneSignal("u1")]);
  await h.svc.loginToOneSignal("u1");
  await h.svc.loginToOneSignal("u1");
  eq(h.dev.optIns, 0, "optIn on a declined device");
  eq(h.dev.alerts, 0, "alerts on a declined device");
});

Deno.test("#4517 granted device: four logins = exactly 1 optIn, same promise reused", async () => {
  const h = await harness({ prompted: true, granted: true });
  const p1 = h.svc.loginToOneSignal("u1");
  const p2 = h.svc.loginToOneSignal("u1");
  assert(p1 === p2, "a concurrent same-user call returns the same promise");
  await Promise.all([p1, p2]);
  await h.svc.loginToOneSignal("u1");
  await h.svc.loginToOneSignal("u1");
  eq(h.dev.optIns, 1, "optIn across four calls");
  eq(h.dev.alerts, 0, "alerts");
});

Deno.test("#4517 logout clears the guard: login runs again (same and different user)", async () => {
  const h = await harness({ prompted: true, granted: true });
  await h.svc.loginToOneSignal("u1");
  h.svc.logoutOneSignal();
  await h.svc.loginToOneSignal("u1");
  eq(h.dev.optIns, 2, "a new session for the same user opts in again");
  h.svc.logoutOneSignal();
  await h.svc.loginToOneSignal("u2");
  eq(h.dev.optIns, 3, "a different user opts in");
  eq(h.dev.alerts, 0, "alerts");
});

Deno.test("#4517 a grant before login finishes still opts in exactly once", async () => {
  const h = await harness({ prompted: false, granted: false });
  await h.svc.requestPushPermission(); // no user yet: no optIn here
  eq(h.dev.optIns, 0, "optIn with nobody logged in");
  await h.svc.loginToOneSignal("u1"); // sees answered + granted
  eq(h.dev.optIns, 1, "optIn once the user is logged in");
});

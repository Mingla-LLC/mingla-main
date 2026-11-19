// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4517 (amendment) — an already-onboarded, signed-in user who was never asked
// for notifications gets the gated request once per app session on reaching home.
//
// MINGLA-INVARIANT: push optIn never runs on an unanswered or denied permission,
// and the OS prompt is raised at most once per session by the shared single-flight
// gate (the post-onboarding call and the returning-user call cannot double-prompt).
//
// Loads the REAL permissionOrchestrator.ts with its imports rewritten to data:
// stub modules (read access only).
//
// FAILS-ON-REVERT: calling requestPushPermission() with no canRequest gate fails
// the answered-user case; dropping the shared _pushRequestInFlight fails the
// no-double-prompt case; dropping a guard in the app/index.tsx effect fails the
// source case.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const toData = (code: string): string => {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "data:application/typescript;base64," + btoa(bin);
};

const g = () => globalThis.__po4517;
const RN_STUB = toData(
  `export const Platform = { get OS() { return globalThis.__po4517.os; } };
   export const AppState = {
     currentState: "active",
     addEventListener() { return { remove() {} }; },
   };`,
);
const PUSH_STUB = toData(
  `export const canRequestPushPermission = async () => {
     const s = globalThis.__po4517;
     s.calls.can++;
     await new Promise((r) => setTimeout(r, 0));
     return s.canRequest;
   };
   export const requestPushPermission = async () => {
     const s = globalThis.__po4517;
     s.calls.request++;
     s.calls.order.push("push");
     return true;
   };`,
);
const AF_STUB = toData(`export const startAppsFlyer = () => {};`);
const TIMING_STUB = toData(`export const shouldRequestAttNow = (st) => st === "active";`);
const ATT_STUB = toData(
  `export const requestTrackingPermissionsAsync = async () => {
     const s = globalThis.__po4517;
     await s.att;
     s.calls.order.push("att");
   };`,
);

const SERVICE_URL = new URL("../permissionOrchestrator.ts", import.meta.url);
let nonce = 0;

async function load(opts: { canRequest: boolean; os?: string; att?: Promise<void> }) {
  globalThis.__po4517 = {
    os: opts.os ?? "android",
    canRequest: opts.canRequest,
    att: opts.att ?? Promise.resolve(),
    calls: { can: 0, request: 0, order: [] as string[] },
  };
  const source = Deno.readTextFileSync(SERVICE_URL)
    .replace("from 'react-native'", `from "${RN_STUB}"`)
    .replace("from 'react-native'", `from "${RN_STUB}"`)
    .replace("from './oneSignalService'", `from "${PUSH_STUB}"`)
    .replace("from './appsFlyerService'", `from "${AF_STUB}"`)
    .replace("from '../utils/attRequestTiming'", `from "${TIMING_STUB}"`)
    .replace("import('expo-tracking-transparency')", `import("${ATT_STUB}")`);
  for (const stub of [RN_STUB, PUSH_STUB, AF_STUB, TIMING_STUB, ATT_STUB]) {
    assert(source.includes(stub), "every orchestrator import must be stubbed");
  }
  const svc = await import(toData(`${source}\n// load ${nonce++}`));
  return { svc, calls: g().calls };
}

Deno.test("#4517 never-asked returning user: exactly one request; repeated calls collapse", async () => {
  const h = await load({ canRequest: true });
  await Promise.all([h.svc.requestReturningUserPushPermission(), h.svc.requestReturningUserPushPermission()]);
  await h.svc.requestReturningUserPushPermission();
  assert(h.calls.request === 1, `expected 1 request, got ${h.calls.request}`);
});

Deno.test("#4517 first call asks nobody (SDK not ready), a later call asks exactly once", async () => {
  const h = await load({ canRequest: false });
  await h.svc.requestReturningUserPushPermission();
  assert(h.calls.request === 0, "nobody asked while the SDK is not ready");
  g().canRequest = true;
  await h.svc.requestReturningUserPushPermission();
  await h.svc.requestReturningUserPushPermission();
  assert(h.calls.request === 1, `expected exactly 1 request, got ${h.calls.request}`);
});

Deno.test("#4517 after a real request, further calls ask zero more times", async () => {
  const h = await load({ canRequest: true });
  await h.svc.requestReturningUserPushPermission();
  await h.svc.requestPostTourPermissions();
  await h.svc.requestReturningUserPushPermission();
  assert(h.calls.request === 1, `expected 1 request, got ${h.calls.request}`);
});

Deno.test("#4517 two concurrent calls ask at most once", async () => {
  const h = await load({ canRequest: true });
  await Promise.all([h.svc.requestReturningUserPushPermission(), h.svc.requestReturningUserPushPermission()]);
  assert(h.calls.request === 1, `expected 1 request, got ${h.calls.request}`);
  assert(h.calls.can === 1, `concurrent callers share one check, got ${h.calls.can}`);
});

Deno.test("#4517 already-answered user: never asked again", async () => {
  const h = await load({ canRequest: false });
  await h.svc.requestReturningUserPushPermission();
  assert(h.calls.request === 0, `expected 0 requests, got ${h.calls.request}`);
});

Deno.test("#4517 no double prompt with the post-onboarding call", async () => {
  const h = await load({ canRequest: true });
  await Promise.all([h.svc.requestPostTourPermissions(), h.svc.requestReturningUserPushPermission()]);
  assert(h.calls.request === 1, `expected 1 request, got ${h.calls.request}`);
});

Deno.test("#4517 iOS: the push request runs after ATT resolves", async () => {
  let release: () => void = () => {};
  const att = new Promise<void>((r) => { release = r; });
  const h = await load({ canRequest: true, os: "ios", att });
  const p = h.svc.requestReturningUserPushPermission();
  await new Promise((r) => setTimeout(r, 20));
  assert(h.calls.request === 0, "push must wait for ATT");
  release();
  await p;
  assert(JSON.stringify(h.calls.order) === JSON.stringify(["att", "push"]), `order was ${JSON.stringify(h.calls.order)}`);
});

Deno.test("#4517 index.tsx calls it only for a signed-in, onboarded, hydrated user", () => {
  const src = Deno.readTextFileSync(new URL("../../../app/index.tsx", import.meta.url))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const i = src.indexOf("requestReturningUserPushPermission()");
  assert(i > 0, "home effect must call requestReturningUserPushPermission()");
  const guard = src.slice(src.lastIndexOf("useEffect(", i), i);
  for (const needle of ["_hasHydrated", "isLoadingAuth", "isAuthenticated", "user?.id", "showOnboardingFlow", "has_completed_onboarding !== true"]) {
    assert(guard.includes(needle), `guard must include ${needle}`);
  }
});

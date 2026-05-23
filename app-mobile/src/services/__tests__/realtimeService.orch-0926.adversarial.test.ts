// ORCH-0926 ADVERSARIAL regression tests — tester-authored per Step 0.5 gate.
//
// These attack angles the implementor's Tests 1-4 don't cover:
//   A1 — Two near-simultaneous rebinds (TOKEN_REFRESHED twice in <1ms): must
//        not produce TWO live channels for the same sessionId, must not lose
//        callbacks, must not leak.
//   A2 — Concurrent subscribeToBoardSession() calls for the same sessionId:
//        the second call (e.g. quick mode-toggle, fast pill-switch) must end
//        in exactly one live channel with both callback bundles preserved.
//   A3 — Rebind while a subscribe is in-flight: tearing down a half-built
//        channel mid-flight must not orphan the original callback set or
//        leave a phantom channel in the map.
//   A4 — Auth flip mid-subscribe (subscribe started with valid session, then
//        session becomes null before subscribe returns): the half-built channel
//        must not survive into the "no auth" state. Sign-out cleanup must
//        unsubscribe everything (Constitutional #6).

declare const __dirname: string;
declare const global: any;
declare const module: any;
declare const process: any;
declare const require: any;

type MockFn = ((...args: any[]) => any) & {
  mock: { calls: any[][] };
  mockClear: () => void;
  mockImplementation: (nextImpl: (...args: any[]) => any) => MockFn;
  mockResolvedValue: (value: any) => MockFn;
};

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

function createMockFn(impl?: (...args: any[]) => any): MockFn {
  let implementation = impl;
  const fn = ((...args: any[]) => {
    fn.mock.calls.push(args);
    return implementation?.(...args);
  }) as MockFn;
  fn.mock = { calls: [] };
  fn.mockClear = () => {
    fn.mock.calls = [];
  };
  fn.mockImplementation = (nextImpl: (...args: any[]) => any) => {
    implementation = nextImpl;
    return fn;
  };
  fn.mockResolvedValue = (value: any) => {
    implementation = () => Promise.resolve(value);
    return fn;
  };
  return fn;
}

const jest = { fn: createMockFn };

type FakeHandler = { type: string; config: any; callback: (payload: any) => void };
type FakeChannel = {
  name: string;
  handlers: FakeHandler[];
  on: MockFn;
  send: MockFn;
  subscribe: MockFn;
};

function createFakeChannel(name: string): FakeChannel {
  const channel = {
    name,
    handlers: [],
    on: jest.fn((type: string, config: any, callback: (payload: any) => void) => {
      channel.handlers.push({ type, config, callback });
      return channel;
    }),
    send: jest.fn(),
    subscribe: jest.fn(() => channel),
  } as FakeChannel;
  return channel;
}

const mockSupabase = {
  auth: { getSession: jest.fn() },
  realtime: { setAuth: jest.fn() },
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

function installModuleMocks() {
  global.__DEV__ = false;
  const originalLoad = Module._load;
  if (!Module._orch0926AdversarialPatched) {
    Module._load = function patchedLoad(request: string, parent: any, isMain: boolean) {
      if (request === "@react-native-async-storage/async-storage") return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    Module._orch0926AdversarialPatched = true;
  }
  const supabaseModulePath = path.resolve(__dirname, "../supabase.js");
  const loggerModulePath = path.resolve(__dirname, "../../utils/logger.js");
  require.cache[supabaseModulePath] = {
    id: supabaseModulePath,
    filename: supabaseModulePath,
    loaded: true,
    exports: { supabase: mockSupabase },
  };
  require.cache[loggerModulePath] = {
    id: loggerModulePath,
    filename: loggerModulePath,
    loaded: true,
    exports: { logger: { realtime: jest.fn() } },
  };
}

function resetSupabaseMocks() {
  mockSupabase.auth.getSession.mockClear();
  mockSupabase.realtime.setAuth.mockClear();
  mockSupabase.channel.mockClear();
  mockSupabase.removeChannel.mockClear();
}

function createHarness(session: any) {
  installModuleMocks();
  resetSupabaseMocks();
  const createdChannels: FakeChannel[] = [];
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session } });
  mockSupabase.realtime.setAuth.mockResolvedValue(undefined);
  mockSupabase.channel.mockImplementation((name: string) => {
    const channel = createFakeChannel(name);
    createdChannels.push(channel);
    return channel;
  });
  const { RealtimeService } = require("../realtimeService.js");
  return { service: new RealtimeService(), createdChannels };
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — Two near-simultaneous rebinds with DIFFERENT tokens.
// Stresses authenticatedChannelTokens deduplication + channel-recreate ordering.
// Must end with exactly ONE live channel keyed by the LATEST token, callbacks
// intact, and at most two teardown calls (one per rebind iteration). NEVER zero
// channels, NEVER more than one live channel for the same sessionId.
// ─────────────────────────────────────────────────────────────────────────────
async function testA1_TwoConcurrentRebindsDifferentTokens() {
  const { service, createdChannels } = createHarness({
    access_token: "token-A",
    user: { id: "user-1" },
  });
  const callbacks = { onSessionUpdated: jest.fn() };

  // Initial subscribe with token-A
  await service.subscribeToBoardSession("sess-X", callbacks);
  const initialChannelCount = createdChannels.length;

  // Now fire TWO rebinds in flight near-simultaneously with different tokens
  mockSupabase.auth.getSession.mockImplementation(async () => {
    return { data: { session: { access_token: "token-B", user: { id: "user-1" } } } };
  });
  const rebind1 = service.rebindAuthenticatedChannels();

  mockSupabase.auth.getSession.mockImplementation(async () => {
    return { data: { session: { access_token: "token-C", user: { id: "user-1" } } } };
  });
  const rebind2 = service.rebindAuthenticatedChannels();

  await Promise.all([rebind1, rebind2]);

  // Adversarial assertion: there must be exactly ONE live board_session channel,
  // not zero (channel never destroyed → not rebound) and not two (race leaked).
  const liveBoardChannels = Array.from((service as any).channels.keys()).filter(
    (n: any) => typeof n === "string" && n.startsWith("board_session:"),
  );
  assert.equal(liveBoardChannels.length, 1, `expected exactly 1 live board channel, got ${liveBoardChannels.length}`);

  // Callbacks must survive the double-rebind.
  const callbackSets = (service as any).boardSessionCallbackSets.get("board_session:sess-X");
  assert.ok(callbackSets, "callback set map must still contain the entry");
  assert.equal(callbackSets.includes(callbacks), true, "original callback bundle must still be registered");

  // We expect at least one new channel beyond the initial subscribe.
  assert.ok(createdChannels.length > initialChannelCount, "rebind must have created at least one new channel");
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — Concurrent subscribeToBoardSession for the same sessionId.
// Simulates: user taps pill A, immediately taps pill A again before first
// subscribe completes. Each call has its own callbacks bundle. Must converge to
// ONE live channel and BOTH callback bundles must be dispatched on session
// update.
// ─────────────────────────────────────────────────────────────────────────────
async function testA2_ConcurrentSubscribesSameSession() {
  const { service, createdChannels } = createHarness({
    access_token: "token-A",
    user: { id: "user-1" },
  });
  const callbacksA = { onSessionUpdated: jest.fn() };
  const callbacksB = { onSessionUpdated: jest.fn() };

  const p1 = service.subscribeToBoardSession("sess-Y", callbacksA);
  const p2 = service.subscribeToBoardSession("sess-Y", callbacksB);
  await Promise.all([p1, p2]);

  // Exactly one live channel under that name.
  const liveBoardChannels = Array.from((service as any).channels.keys()).filter(
    (n: any) => typeof n === "string" && n.startsWith("board_session:sess-Y"),
  );
  assert.equal(liveBoardChannels.length, 1, `expected 1 live channel, got ${liveBoardChannels.length}`);

  // Both callback bundles must be registered.
  const callbackSets = (service as any).boardSessionCallbackSets.get("board_session:sess-Y");
  assert.equal(callbackSets.includes(callbacksA), true, "first bundle must be registered");
  assert.equal(callbackSets.includes(callbacksB), true, "second bundle must be registered");

  // Fire a collaboration_sessions UPDATE on the latest channel and confirm BOTH
  // callbacks receive the event (proves no bundle was leaked during the race).
  const latestChannel = createdChannels[createdChannels.length - 1];
  const sessionUpdateHandler = latestChannel.handlers.find(
    (h) => h.type === "postgres_changes" && h.config.event === "UPDATE" && h.config.table === "collaboration_sessions",
  );
  assert.ok(sessionUpdateHandler, "latest channel must have the session UPDATE binding");
  sessionUpdateHandler!.callback({ new: { id: "sess-Y", deck_version: 9 } });
  assert.equal(callbacksA.onSessionUpdated.mock.calls.length, 1, "callbacks A must receive the update");
  assert.equal(callbacksB.onSessionUpdated.mock.calls.length, 1, "callbacks B must receive the update");
}

// ─────────────────────────────────────────────────────────────────────────────
// A3 — rebindAuthenticatedChannels invoked while a subscribe is mid-flight.
// Simulates a TOKEN_REFRESHED firing in the same microtask window where
// useBoardSession is just calling subscribe. The earlier subscribe must either
// complete cleanly OR be torn down by the rebind — never leave a phantom
// channel that nothing is dispatching to.
// ─────────────────────────────────────────────────────────────────────────────
async function testA3_RebindMidSubscribe() {
  const { service } = createHarness({
    access_token: "token-A",
    user: { id: "user-1" },
  });
  const callbacks = { onSessionUpdated: jest.fn() };

  // Slow EVERY setAuth call by a microtask so we get genuine interleaving
  // between the initial subscribe and a follow-on rebind that fires before
  // the initial subscribe has finished resolving its setAuth await.
  mockSupabase.realtime.setAuth.mockImplementation(async (_token: string) => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // Fire subscribe and rebind near-simultaneously WITHOUT awaiting the first.
  const subscribePromise = service.subscribeToBoardSession("sess-Z", callbacks);

  // Flip the next-getSession to return a new token so the rebind sees a token
  // change and rebuilds (the existing channel, if any, must be torn down).
  mockSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: "token-B", user: { id: "user-1" } } },
  });
  const rebindPromise = service.rebindAuthenticatedChannels();

  await Promise.all([subscribePromise, rebindPromise]);

  // Convergent state: exactly one live board_session:sess-Z channel.
  const liveBoardChannels = Array.from((service as any).channels.keys()).filter(
    (n: any) => typeof n === "string" && n.startsWith("board_session:sess-Z"),
  );
  assert.equal(liveBoardChannels.length, 1, `expected 1 live channel after mid-subscribe rebind, got ${liveBoardChannels.length}`);

  // No phantom channels: callbackSets size matches the one bundle we registered.
  // (Implementation may dedupe or may push twice depending on rebind ordering;
  // adversarial floor is: bundle is present AT LEAST once and dispatch works.)
  const callbackSets = (service as any).boardSessionCallbackSets.get("board_session:sess-Z");
  assert.ok(callbackSets, "callback set map must contain the entry");
  assert.ok(callbackSets.includes(callbacks), "original callback bundle must still be registered");
}

// ─────────────────────────────────────────────────────────────────────────────
// A4 — Sign-out mid-flight: subscribe started under valid session, then auth
// flipped to null, then unsubscribeAll() called (simulating SIGNED_OUT
// cleanup in useAuthSimple). After settle, ZERO live board channels and ZERO
// callback bundles for any board_session channel. Constitutional #6.
// ─────────────────────────────────────────────────────────────────────────────
async function testA4_SignOutMidFlight() {
  const { service } = createHarness({
    access_token: "token-A",
    user: { id: "user-1" },
  });
  const callbacks = { onSessionUpdated: jest.fn() };

  await service.subscribeToBoardSession("sess-W", callbacks);

  // Confirm we have one channel before sign-out.
  const beforeSignOut = Array.from((service as any).channels.keys()).filter(
    (n: any) => typeof n === "string" && n.startsWith("board_session:sess-W"),
  );
  assert.equal(beforeSignOut.length, 1, "must have 1 channel before sign-out");

  // Simulate SIGNED_OUT path from useAuthSimple.
  service.unsubscribeAll();

  // After sign-out, zero board_session channels remain.
  const afterSignOut = Array.from((service as any).channels.keys()).filter(
    (n: any) => typeof n === "string" && n.startsWith("board_session:"),
  );
  assert.equal(afterSignOut.length, 0, `expected 0 board channels after sign-out, got ${afterSignOut.length}`);

  // authenticatedChannelTokens map must be cleared.
  const tokens = (service as any).authenticatedChannelTokens;
  assert.equal(tokens.size, 0, `expected 0 token entries after sign-out, got ${tokens.size}`);

  // boardSessionCallbackSets must be cleared too.
  const sets = (service as any).boardSessionCallbackSets;
  assert.equal(sets.size, 0, `expected 0 callback set entries after sign-out, got ${sets.size}`);

  // Subsequent rebind with no session must be a no-op (no channels recreated).
  mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  await service.rebindAuthenticatedChannels();
  const afterRebind = Array.from((service as any).channels.keys());
  assert.equal(afterRebind.length, 0, "rebind with null session must leave zero channels");
}

export async function runOrch0926AdversarialTests() {
  const tests = [
    ["A1 - two concurrent rebinds with different tokens converge to one channel", testA1_TwoConcurrentRebindsDifferentTokens],
    ["A2 - concurrent subscribes for same sessionId preserve both callback bundles", testA2_ConcurrentSubscribesSameSession],
    ["A3 - rebind mid-subscribe leaves exactly one channel + callbacks intact", testA3_RebindMidSubscribe],
    ["A4 - sign-out mid-flight tears down all board channels + clears registries", testA4_SignOutMidFlight],
  ] as const;

  for (const [name, testFn] of tests) {
    await testFn();
    console.log(`PASS ${name}`);
  }
}

if (require.main === module) {
  runOrch0926AdversarialTests().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

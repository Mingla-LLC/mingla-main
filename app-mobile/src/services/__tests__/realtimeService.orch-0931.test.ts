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
const fs = require("node:fs");
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

type FakeHandler = {
  type: string;
  config: any;
  callback: (payload: any) => void;
};

type FakeChannel = {
  name: string;
  options: any;
  handlers: FakeHandler[];
  on: MockFn;
  send: MockFn;
  subscribe: MockFn;
};

function createFakeChannel(name: string, options?: any): FakeChannel {
  const channel = {
    name,
    options,
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
  if (!Module._orch0931Patched) {
    Module._load = function patchedLoad(request: string, parent: any, isMain: boolean) {
      if (request === "@react-native-async-storage/async-storage") return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    Module._orch0931Patched = true;
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

function createHarness() {
  installModuleMocks();
  resetSupabaseMocks();
  const createdChannels: FakeChannel[] = [];
  mockSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: "orch-0931-token", user: { id: "user-1" } } },
  });
  mockSupabase.realtime.setAuth.mockResolvedValue(undefined);
  mockSupabase.channel.mockImplementation((name: string, options?: any) => {
    const channel = createFakeChannel(name, options);
    createdChannels.push(channel);
    return channel;
  });

  const { RealtimeService } = require("../realtimeService.js");
  return { service: new RealtimeService(), createdChannels };
}

async function testPrivateBoardSessionChannel() {
  const { service } = createHarness();

  await service.subscribeToBoardSession("sess-1", {});

  assert.deepEqual(mockSupabase.channel.mock.calls[0], [
    "board_session:sess-1",
    { config: { private: true } },
  ]);
}

async function testBroadcastReplacesPkFilteredSessionUpdate() {
  const { service, createdChannels } = createHarness();

  await service.subscribeToBoardSession("sess-1", {});

  const channel = createdChannels[0];
  const broadcastIndex = channel.handlers.findIndex(
    (handler) => handler.type === "broadcast" && handler.config.event === "session_updated",
  );
  assert.ok(broadcastIndex >= 0, "expected broadcast session_updated registration");
  assert.equal(channel.subscribe.mock.calls.length, 1, "expected subscribe after handler registration chain");

  const revertedUpdate = channel.handlers.find(
    (handler) =>
      handler.type === "postgres_changes" &&
      handler.config.event === "UPDATE" &&
      handler.config.table === "collaboration_sessions" &&
      String(handler.config.filter).startsWith("id=eq."),
  );
  assert.equal(revertedUpdate, undefined, "expected no PK-filtered collaboration_sessions UPDATE binding");
}

async function testBroadcastDispatchPayload() {
  const { service, createdChannels } = createHarness();
  const callbacks = { onSessionUpdated: jest.fn() };
  const payload = {
    session_id: "sess-1",
    deck_version: 42,
    deck_params_hash: "hash-42",
    updated_at: 1784851200,
  };

  await service.subscribeToBoardSession("sess-1", callbacks);

  const handler = createdChannels[0].handlers.find(
    (entry) => entry.type === "broadcast" && entry.config.event === "session_updated",
  );
  assert.ok(handler, "expected broadcast session_updated handler");
  handler!.callback({ event: "session_updated", type: "broadcast", payload });

  assert.equal(callbacks.onSessionUpdated.mock.calls.length, 1);
  assert.deepEqual(callbacks.onSessionUpdated.mock.calls[0], [payload]);
}

function testUseBoardSessionReloadsSessionAfterBroadcast() {
  const hookPath = path.resolve(process.cwd(), "src/hooks/useBoardSession.ts");
  const source = fs.readFileSync(hookPath, "utf8");
  const callbackStart = source.indexOf("onSessionUpdated: (updatedSession: any) => {");
  const callbackEnd = source.indexOf("onParticipantJoined:", callbackStart);
  assert.ok(callbackStart > -1 && callbackEnd > callbackStart, "expected onSessionUpdated callback block");
  const callbackSource = source.slice(callbackStart, callbackEnd);

  assert.match(callbackSource, /void loadSession\(capturedSessionId\)/);
  assert.doesNotMatch(callbackSource, /if\s*\(\s*updatedSession\.participant_prefs\s*\)/);
}

function testUseBoardSessionInvalidatesCollabDeckAfterBroadcast() {
  const hookPath = path.resolve(process.cwd(), "src/hooks/useBoardSession.ts");
  const source = fs.readFileSync(hookPath, "utf8");
  const callbackStart = source.indexOf("onSessionUpdated: (updatedSession: any) => {");
  const callbackEnd = source.indexOf("onParticipantJoined:", callbackStart);
  assert.ok(callbackStart > -1 && callbackEnd > callbackStart, "expected onSessionUpdated callback block");
  const callbackSource = source.slice(callbackStart, callbackEnd);

  assert.match(
    callbackSource,
    /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]deck-cards['"]\s*,\s*['"]collab['"]\s*,\s*capturedSessionId\s*\]/s,
    "expected session_updated to invalidate active collab deck-cards queries",
  );
  assert.match(
    callbackSource,
    /session_updated invalidating deck-cards/,
    "expected explicit diagnostic log for tester live-fire evidence",
  );
}

export async function runOrch0931RealtimeServiceTests() {
  const tests = [
    ["T-IMP-1 - board_session channel is private", testPrivateBoardSessionChannel],
    ["T-IMP-2 - broadcast replaces PK-filtered session UPDATE", testBroadcastReplacesPkFilteredSessionUpdate],
    ["T-IMP-3 - broadcast dispatches payload", testBroadcastDispatchPayload],
    ["T-IMP-4 - useBoardSession reloads session after broadcast", testUseBoardSessionReloadsSessionAfterBroadcast],
    ["T-IMP-5 - useBoardSession invalidates collab deck after broadcast", testUseBoardSessionInvalidatesCollabDeckAfterBroadcast],
  ] as const;

  for (const [name, testFn] of tests) {
    await testFn();
    console.log(`PASS ${name}`);
  }
}

if (require.main === module) {
  runOrch0931RealtimeServiceTests().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

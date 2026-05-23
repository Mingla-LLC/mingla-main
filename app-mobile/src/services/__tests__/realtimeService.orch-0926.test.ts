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

type FakeHandler = {
  type: string;
  config: any;
  callback: (payload: any) => void;
};

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
  auth: {
    getSession: jest.fn(),
  },
  realtime: {
    setAuth: jest.fn(),
  },
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

function installModuleMocks() {
  global.__DEV__ = false;

  const originalLoad = Module._load;
  if (!Module._orch0926Patched) {
    Module._load = function patchedLoad(request: string, parent: any, isMain: boolean) {
      if (request === "@react-native-async-storage/async-storage") {
        return {};
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    Module._orch0926Patched = true;
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
    exports: {
      logger: {
        realtime: jest.fn(),
      },
    },
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
  return {
    service: new RealtimeService(),
    createdChannels,
  };
}

async function testHappyPathSetAuthBeforeSubscribe() {
  const { service } = createHarness({
    access_token: "test-jwt-001",
    user: { id: "user-1" },
  });
  let setAuthResolved = false;
  mockSupabase.realtime.setAuth.mockImplementation(async (token: string) => {
    assert.equal(token, "test-jwt-001");
    await Promise.resolve();
    setAuthResolved = true;
  });
  mockSupabase.channel.mockImplementation((name: string) => {
    assert.equal(setAuthResolved, true, "channel must be created only after setAuth resolves");
    return createFakeChannel(name);
  });

  const channel = await service.subscribeToBoardSession("sess-1", {});

  assert.equal(mockSupabase.realtime.setAuth.mock.calls.length, 1);
  assert.deepEqual(mockSupabase.realtime.setAuth.mock.calls[0], ["test-jwt-001"]);
  assert.deepEqual(mockSupabase.channel.mock.calls[0], ["board_session:sess-1"]);
  assert.equal(channel?.subscribe.mock.calls.length, 1);
}

async function testDefersWithoutAuthSession() {
  const { service } = createHarness(null);

  const channel = await service.subscribeToBoardSession("sess-2", {});

  assert.equal(channel, null);
  assert.equal(mockSupabase.realtime.setAuth.mock.calls.length, 0);
  assert.equal(mockSupabase.channel.mock.calls.length, 0);
}

async function testTokenRefreshRebindsBoardSessionWithCallbacks() {
  const { service, createdChannels } = createHarness({
    access_token: "old-token",
    user: { id: "user-1" },
  });
  const callbacks = {
    onSessionUpdated: jest.fn(),
  };

  const oldChannel = await service.subscribeToBoardSession("sess-1", callbacks);

  mockSupabase.auth.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: "new-token",
        user: { id: "user-1" },
      },
    },
  });

  await service.rebindAuthenticatedChannels();

  assert.equal(mockSupabase.removeChannel.mock.calls.some(([channel]: any[]) => channel === oldChannel), true);
  assert.equal(mockSupabase.realtime.setAuth.mock.calls.some(([token]: any[]) => token === "new-token"), true);
  assert.deepEqual(
    mockSupabase.channel.mock.calls.map(([name]: any[]) => name),
    ["board_session:sess-1", "board_session:sess-1"],
  );

  const callbackSets = (service as any).boardSessionCallbackSets.get("board_session:sess-1");
  assert.equal(callbackSets.includes(callbacks), true);

  const reboundChannel = createdChannels[1];
  const sessionUpdateHandler = reboundChannel.handlers.find(
    (handler) =>
      handler.type === "postgres_changes" &&
      handler.config.event === "UPDATE" &&
      handler.config.table === "collaboration_sessions",
  );
  assert.ok(sessionUpdateHandler, "rebuilt channel must keep the collaboration_sessions UPDATE binding");

  sessionUpdateHandler!.callback({ new: { id: "sess-1", deck_version: 2 } });
  assert.deepEqual(callbacks.onSessionUpdated.mock.calls[0], [{ id: "sess-1", deck_version: 2 }]);
}

async function testBroadcastOnlyChannelsSurviveRebind() {
  const { service } = createHarness(null);
  const boardChannel = createFakeChannel("board_session:sess-1");
  const chatChannel = createFakeChannel("chat:conv-1");

  (service as any).channels.set("board_session:sess-1", boardChannel);
  (service as any).channels.set("chat:conv-1", chatChannel);

  await service.rebindAuthenticatedChannels();

  assert.equal(mockSupabase.removeChannel.mock.calls.some(([channel]: any[]) => channel === boardChannel), true);
  assert.equal(mockSupabase.removeChannel.mock.calls.some(([channel]: any[]) => channel === chatChannel), false);
  assert.equal((service as any).channels.has("chat:conv-1"), true);
}

export async function runOrch0926RealtimeServiceTests() {
  const tests = [
    ["Test 1 - setAuth is awaited before channel subscribe", testHappyPathSetAuthBeforeSubscribe],
    ["Test 2 - subscribe deferred when no auth session", testDefersWithoutAuthSession],
    ["Test 3 - token refresh rebinds board-session with callbacks", testTokenRefreshRebindsBoardSessionWithCallbacks],
    ["Test 4 - broadcast-only channels are not affected by rebind", testBroadcastOnlyChannelsSurviveRebind],
  ] as const;

  for (const [name, testFn] of tests) {
    await testFn();
    console.log(`PASS ${name}`);
  }
}

if (require.main === module) {
  runOrch0926RealtimeServiceTests().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

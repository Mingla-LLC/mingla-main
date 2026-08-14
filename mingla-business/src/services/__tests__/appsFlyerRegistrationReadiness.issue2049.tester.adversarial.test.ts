import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type InitSuccess = (result: unknown) => void;
type AppsFlyerUidCallback = (error: unknown, uid: string) => void;
type AuthResult = { data: { user: { id: string } | null } };

const mockRuntime: {
  initSuccess: InitSuccess | null;
  uidCallbacks: AppsFlyerUidCallback[];
  currentUserId: string | null;
  upsertErrors: Array<{ message: string } | null>;
} = {
  initSuccess: null,
  uidCallbacks: [],
  currentUserId: null,
  upsertErrors: [],
};

const mockSetCustomerUserId = jest.fn(
  (_userId: string, callback: (result: unknown) => void): void => callback({}),
);
const mockGetAppsFlyerUID = jest.fn((callback: AppsFlyerUidCallback): void => {
  mockRuntime.uidCallbacks.push(callback);
});
const mockUpsert = jest.fn(async () => ({
  error: mockRuntime.upsertErrors.shift() ?? null,
}));
const mockGetUser = jest.fn(async (): Promise<AuthResult> => ({
  data: {
    user: mockRuntime.currentUserId ? { id: mockRuntime.currentUserId } : null,
  },
}));
const mockInitSdk = jest.fn(
  (
    _config: unknown,
    success: InitSuccess,
    _failure: (error: unknown) => void,
  ): void => {
    mockRuntime.initSuccess = success;
  },
);

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: mockInitSdk,
    setCustomerUserId: mockSetCustomerUserId,
    getAppsFlyerUID: mockGetAppsFlyerUID,
    logEvent: jest.fn(),
    onDeepLink: jest.fn(() => () => {}),
    setOneLinkCustomDomains: jest.fn(),
    performOnDeepLinking: jest.fn(),
  },
}));

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

type ServiceModule = typeof import("../appsFlyerService");

async function importReadyService(): Promise<ServiceModule> {
  const service = await import("../appsFlyerService");
  service.initializeAppsFlyer();
  expect(mockRuntime.initSuccess).not.toBeNull();
  mockRuntime.initSuccess?.({ status: "ok" });
  return service;
}

function resolveNextUid(error: unknown, uid = "tester-appsflyer-uid"): void {
  const callback = mockRuntime.uidCallbacks.shift();
  expect(callback).toBeDefined();
  callback?.(error, uid);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("issue #2049 tester adversarial registration interleavings", () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRuntime.initSuccess = null;
    mockRuntime.uidCallbacks = [];
    mockRuntime.currentUserId = null;
    mockRuntime.upsertErrors = [];
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "tester-dev-key";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID =
      "com.sethogieva.minglabusiness";
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("T6 rejects a stale UID callback when auth changes before validation resolves", async () => {
    let resolveAuth!: (result: AuthResult) => void;
    const delayedAuth = new Promise<AuthResult>((resolve) => {
      resolveAuth = resolve;
    });
    mockGetUser.mockImplementationOnce(() => delayedAuth);
    mockRuntime.currentUserId = "user-a";
    const service = await importReadyService();

    service.registerAppsFlyerDevice("user-a");
    resolveNextUid(null);
    mockRuntime.currentUserId = "user-b";
    resolveAuth({ data: { user: { id: "user-b" } } });
    await flushPromises();

    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("T7 leaves UID failures retryable and emits no private identifier", async () => {
    mockRuntime.currentUserId = "uid-retry-user";
    const service = await importReadyService();

    service.registerAppsFlyerDevice("uid-retry-user");
    resolveNextUid(new Error("synthetic UID failure"), "");
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[AppsFlyer] getAppsFlyerUID failed:",
      expect.any(Error),
    );

    service.registerAppsFlyerDevice("uid-retry-user");
    resolveNextUid(null);
    await flushPromises();

    expect(mockGetAppsFlyerUID).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("uid-retry-user");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "tester-appsflyer-uid",
    );
  });

  test("T8 retries the same device after an upsert failure and deduplicates only after success", async () => {
    mockRuntime.currentUserId = "upsert-retry-user";
    mockRuntime.upsertErrors = [
      { message: "synthetic persistence failure" },
      null,
    ];
    const service = await importReadyService();

    service.registerAppsFlyerDevice("upsert-retry-user");
    resolveNextUid(null);
    await flushPromises();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[AppsFlyer] Device registration failed:",
      "synthetic persistence failure",
    );

    service.registerAppsFlyerDevice("upsert-retry-user");
    resolveNextUid(null);
    await flushPromises();
    expect(mockUpsert).toHaveBeenCalledTimes(2);

    service.registerAppsFlyerDevice("upsert-retry-user");
    resolveNextUid(null);
    await flushPromises();
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  test("T9 suppresses a second persistence cycle after the same user and UID succeed", async () => {
    mockRuntime.currentUserId = "duplicate-user";
    const service = await importReadyService();

    service.registerAppsFlyerDevice("duplicate-user");
    resolveNextUid(null, "stable-device-uid");
    await flushPromises();
    service.registerAppsFlyerDevice("duplicate-user");
    resolveNextUid(null, "stable-device-uid");
    await flushPromises();

    expect(mockGetAppsFlyerUID).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  test("a logout between two pre-ready accounts cancels only the old account", async () => {
    const service = await import("../appsFlyerService");
    mockRuntime.currentUserId = "signed-out-user";
    service.setAppsFlyerUserId("signed-out-user");
    service.registerAppsFlyerDevice("signed-out-user");

    service.clearAppsFlyerUserId();
    service.resetAppsFlyerDeviceCache();
    mockRuntime.currentUserId = "replacement-user";
    service.setAppsFlyerUserId("replacement-user");
    service.registerAppsFlyerDevice("replacement-user");

    service.initializeAppsFlyer();
    expect(mockRuntime.initSuccess).not.toBeNull();
    mockRuntime.initSuccess?.({ status: "ok" });
    resolveNextUid(null);
    await flushPromises();

    expect(mockSetCustomerUserId).toHaveBeenCalledTimes(1);
    expect(mockSetCustomerUserId).toHaveBeenCalledWith(
      "replacement-user",
      expect.any(Function),
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "replacement-user",
        app: "business",
        platform: "android",
        app_id: "com.sethogieva.minglabusiness",
      }),
      { onConflict: "user_id,app,appsflyer_uid" },
    );
  });
});

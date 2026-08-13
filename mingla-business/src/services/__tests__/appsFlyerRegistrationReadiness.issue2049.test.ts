import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type InitSuccess = (result: unknown) => void;
type AppsFlyerUidCallback = (error: unknown, uid: string) => void;

const mockRuntime: {
  platform: "ios" | "android";
  initSuccess: InitSuccess | null;
  currentUserId: string | null;
} = {
  platform: "android",
  initSuccess: null,
  currentUserId: null,
};

const mockSetCustomerUserId = jest.fn(
  (_userId: string, callback: (result: unknown) => void): void => callback({}),
);
const mockGetAppsFlyerUID = jest.fn((callback: AppsFlyerUidCallback): void =>
  callback(null, "test-appsflyer-uid"),
);
const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));
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
  Platform: {
    get OS(): "ios" | "android" {
      return mockRuntime.platform;
    },
  },
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
    auth: {
      getUser: jest.fn(async () => ({
        data: {
          user: mockRuntime.currentUserId
            ? { id: mockRuntime.currentUserId }
            : null,
        },
      })),
    },
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

const setEnv = (): void => {
  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "test-dev-key";
  process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
  process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID =
    "com.sethogieva.minglabusiness";
};

type ServiceModule = typeof import("../appsFlyerService");

async function importService(): Promise<ServiceModule> {
  return import("../appsFlyerService");
}

function succeedInitialization(): void {
  expect(mockRuntime.initSuccess).not.toBeNull();
  mockRuntime.initSuccess?.({ status: "ok" });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expectCanonicalUpsert(
  userId: string,
  platform: "ios" | "android",
  appId: string,
): void {
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: userId,
      appsflyer_uid: "test-appsflyer-uid",
      platform,
      app_id: appId,
      app: "business",
      updated_at: expect.any(String),
    }),
    { onConflict: "user_id,app,appsflyer_uid" },
  );
}

describe("issue #2049 AppsFlyer auth-readiness replay", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRuntime.platform = "android";
    mockRuntime.initSuccess = null;
    mockRuntime.currentUserId = null;
    setEnv();
  });

  test("T1 replays Android identity and registration after init succeeds", async () => {
    const service = await importService();
    mockRuntime.currentUserId = "android-user";

    service.setAppsFlyerUserId("android-user");
    service.registerAppsFlyerDevice("android-user");
    expect(mockSetCustomerUserId).not.toHaveBeenCalled();
    expect(mockGetAppsFlyerUID).not.toHaveBeenCalled();

    service.initializeAppsFlyer();
    succeedInitialization();
    await flushPromises();

    expect(mockSetCustomerUserId).toHaveBeenCalledTimes(1);
    expect(mockSetCustomerUserId).toHaveBeenCalledWith(
      "android-user",
      expect.any(Function),
    );
    expect(mockGetAppsFlyerUID).toHaveBeenCalledTimes(1);
    expectCanonicalUpsert(
      "android-user",
      "android",
      "com.sethogieva.minglabusiness",
    );
  });

  test("T2 replays iOS identity and registration after init succeeds", async () => {
    mockRuntime.platform = "ios";
    const service = await importService();
    mockRuntime.currentUserId = "ios-user";

    service.setAppsFlyerUserId("ios-user");
    service.registerAppsFlyerDevice("ios-user");
    service.initializeAppsFlyer();
    succeedInitialization();
    await flushPromises();

    expect(mockSetCustomerUserId).toHaveBeenCalledTimes(1);
    expect(mockGetAppsFlyerUID).toHaveBeenCalledTimes(1);
    expectCanonicalUpsert("ios-user", "ios", "6768737367");
  });

  test("T3 preserves immediate registration when init succeeds first", async () => {
    const service = await importService();
    mockRuntime.currentUserId = "ready-user";

    service.initializeAppsFlyer();
    succeedInitialization();
    service.setAppsFlyerUserId("ready-user");
    service.registerAppsFlyerDevice("ready-user");
    await flushPromises();

    expect(mockSetCustomerUserId).toHaveBeenCalledTimes(1);
    expect(mockGetAppsFlyerUID).toHaveBeenCalledTimes(1);
    expectCanonicalUpsert(
      "ready-user",
      "android",
      "com.sethogieva.minglabusiness",
    );
  });

  test("T4 retains only the latest authenticated user before readiness", async () => {
    const service = await importService();

    mockRuntime.currentUserId = "user-a";
    service.setAppsFlyerUserId("user-a");
    service.registerAppsFlyerDevice("user-a");

    mockRuntime.currentUserId = "user-b";
    service.setAppsFlyerUserId("user-b");
    service.registerAppsFlyerDevice("user-b");
    service.initializeAppsFlyer();
    succeedInitialization();
    await flushPromises();

    expect(mockSetCustomerUserId).toHaveBeenCalledTimes(1);
    expect(mockSetCustomerUserId).toHaveBeenCalledWith(
      "user-b",
      expect.any(Function),
    );
    expectCanonicalUpsert("user-b", "android", "com.sethogieva.minglabusiness");
  });

  test("T5 logout clears queued identity and registration before readiness", async () => {
    const service = await importService();
    mockRuntime.currentUserId = "signed-out-user";

    service.setAppsFlyerUserId("signed-out-user");
    service.registerAppsFlyerDevice("signed-out-user");
    service.clearAppsFlyerUserId();
    service.resetAppsFlyerDeviceCache();
    mockRuntime.currentUserId = null;

    service.initializeAppsFlyer();
    succeedInitialization();
    await flushPromises();

    expect(mockSetCustomerUserId).not.toHaveBeenCalled();
    expect(mockGetAppsFlyerUID).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

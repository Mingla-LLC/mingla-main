// MINGLA-INVARIANT: I-4549-HOST-ANDROID-PUSH-BUILD | issue #4549 | a release-bound EAS Android build of the Host app with push enabled fails app.config evaluation unless it links react-native-onesignal and carries the Google services file; local, development, web, jest and iOS evaluation never need the file and never set googleServicesFile without it.
/**
 * #4549 S0 — Android push build wiring and guard in mingla-business/app.config.js.
 *
 * Fails on revert: delete the assertAndroidPushBuildReady call and the
 * "throws" cases go green-to-red; delete withGoogleServicesFile and the
 * "googleServicesFile is set" case fails; restore the autolinking exclusion
 * and the "links OneSignal" case fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "../..");
const appConfigPath = path.join(businessRoot, "app.config.js");
const packageJsonPath = path.join(businessRoot, "package.json");
const appJson = JSON.parse(
  fs.readFileSync(path.join(businessRoot, "app.json"), "utf8"),
) as { expo: { android: Record<string, unknown>; ios: Record<string, unknown> } };

const ORIGINAL_ENV = process.env;

/** Shape-only placeholders; not real keys. */
const RELEASE_ENV = {
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "af_dev_key_placeholder",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.mingla.business.placeholder",
  EXPO_PUBLIC_GIPHY_API_KEY: "giphy_key_placeholder",
  EXPO_PUBLIC_ONESIGNAL_APP_ID: "4505e476-0000-4000-8000-000000000000",
  MINGLA_STRIPE_MODE: "live",
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_" + "0".repeat(24),
} as const;

let tmpDir = "";
let fakeServicesFile = "";

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "i4549-gs-"));
  fakeServicesFile = path.join(tmpDir, "google-services.json");
  fs.writeFileSync(fakeServicesFile, JSON.stringify({ project_info: {} }));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
  jest.dontMock(packageJsonPath);
});

type Resolved = { android?: Record<string, unknown> };

function run(env: Record<string, string | undefined>): Resolved {
  jest.resetModules();
  const next: Record<string, string | undefined> = { ...ORIGINAL_ENV };
  delete next.EAS_BUILD_PROFILE;
  delete next.EAS_BUILD_PLATFORM;
  delete next.GOOGLE_SERVICES_JSON;
  process.env = { ...next, ...env } as NodeJS.ProcessEnv;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const configFn = require(appConfigPath) as (ctx: never) => Resolved;
  return configFn({
    config: { plugins: [], android: appJson.expo.android, ios: appJson.expo.ios },
  } as never);
}

describe("#4549 S0 Android push build config", () => {
  test("local evaluation without the file: no googleServicesFile, no throw", () => {
    const out = run({});
    expect(out.android?.googleServicesFile).toBeUndefined();
    expect(out.android?.package).toBe("com.sethogieva.minglabusiness");
  });

  test("the EAS file variable sets googleServicesFile and keeps the android block", () => {
    const out = run({ GOOGLE_SERVICES_JSON: fakeServicesFile });
    expect(out.android?.googleServicesFile).toBe(fakeServicesFile);
    expect(out.android?.package).toBe("com.sethogieva.minglabusiness");
  });

  test("a blank variable is treated as absent", () => {
    expect(run({ GOOGLE_SERVICES_JSON: "   " }).android?.googleServicesFile).toBeUndefined();
  });

  test.each(["production", "production-apk", "preview"])(
    "release-bound %s Android build with push and no file throws naming #4549",
    (profile) => {
      expect(() =>
        run({ ...RELEASE_ENV, EAS_BUILD_PROFILE: profile, EAS_BUILD_PLATFORM: "android" }),
      ).toThrow(/GOOGLE_SERVICES_JSON is required .*Android.*\[#4549\]/);
    },
  );

  test("release-bound Android build whose file path does not exist throws", () => {
    expect(() =>
      run({
        ...RELEASE_ENV,
        EAS_BUILD_PROFILE: "production",
        EAS_BUILD_PLATFORM: "android",
        GOOGLE_SERVICES_JSON: path.join(tmpDir, "missing.json"),
      }),
    ).toThrow(/does not exist .*\[#4549\]/);
  });

  test("release-bound Android build with the file configures", () => {
    const out = run({
      ...RELEASE_ENV,
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_PLATFORM: "android",
      GOOGLE_SERVICES_JSON: fakeServicesFile,
    });
    expect(out.android?.googleServicesFile).toBe(fakeServicesFile);
  });

  test("release-bound iOS build never needs the Android file", () => {
    expect(() =>
      run({ ...RELEASE_ENV, EAS_BUILD_PROFILE: "production", EAS_BUILD_PLATFORM: "ios" }),
    ).not.toThrow();
  });

  test("development Android build without the file still configures", () => {
    expect(() =>
      run({ ...RELEASE_ENV, EAS_BUILD_PROFILE: "development", EAS_BUILD_PLATFORM: "android" }),
    ).not.toThrow();
  });

  test("package.json links OneSignal on Android", () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    expect(pkg.expo?.autolinking?.android?.exclude ?? []).not.toContain(
      "react-native-onesignal",
    );
  });

  test("adversarial: the exclusion coming back fails a release Android build even with the file", () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    jest.doMock(packageJsonPath, () => ({
      ...pkg,
      expo: {
        ...pkg.expo,
        autolinking: { android: { exclude: ["react-native-onesignal", "react-native-purchases"] } },
      },
    }));
    expect(() =>
      run({
        ...RELEASE_ENV,
        EAS_BUILD_PROFILE: "production",
        EAS_BUILD_PLATFORM: "android",
        GOOGLE_SERVICES_JSON: fakeServicesFile,
      }),
    ).toThrow(/excluded from Android autolinking.*\[#4549\]/);
  });
});

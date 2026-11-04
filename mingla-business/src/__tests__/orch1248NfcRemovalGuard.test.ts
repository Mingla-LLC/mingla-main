/**
 * ORCH-1248 (Apple 2.1) + #4271 (Tap to Pay) — NFC and card-reader entitlement guard.
 *
 * History: the unused react-native-nfc-manager library auto-linked CoreNFC and
 * Apple flagged the binary (guideline 2.1). It was removed and this guard kept it
 * out. #4271 adds Tap to Pay through Stripe Terminal, which deliberately changes
 * two of the original rules:
 *
 * - Android Tap to Pay needs android.permission.NFC. It is allowed ONLY because the
 *   Stripe Terminal Tap to Pay library contributes it through its merged manifest.
 *   Mingla itself (app.json, app.config.js, local config plugins) never declares
 *   it, and never blocks it.
 * - Tap to Pay on iPhone uses Apple's ProximityReader framework, not CoreNFC. Its
 *   entitlement (com.apple.developer.proximity-reader.payment.acceptance) may only
 *   appear through the MINGLA_TAP_TO_PAY_ENTITLEMENT=1 build gate in
 *   app.config.js, so builds keep signing until Apple grants it.
 *
 * Still forbidden: react-native-nfc-manager anywhere, and any CoreNFC usage or
 * NFC tag-reading entitlement in Mingla's own code or config.
 *
 * fails-on-revert: re-adding react-native-nfc-manager, declaring
 * android.permission.NFC in app.json or a local plugin, importing CoreNFC,
 * removing the Stripe Terminal plugin, adding the proximity-reader entitlement to
 * app.json, or making the app.config.js gate unconditional fails an assertion.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const BIZ_ROOT = path.join(__dirname, "..", "..");
const NFC_PERMISSION = "android.permission.NFC";
const TAP_TO_PAY_ENTITLEMENT =
  "com.apple.developer.proximity-reader.payment.acceptance";
const TERMINAL_PACKAGE = "@stripe/stripe-terminal-react-native";

type AppJson = {
  expo: {
    ios?: { entitlements?: Record<string, unknown> };
    android?: { permissions?: string[]; blockedPermissions?: string[] };
    plugins?: unknown[];
  };
};

type ResolvedConfig = {
  ios?: { entitlements?: Record<string, unknown> };
  android?: { permissions?: string[]; blockedPermissions?: string[] };
  plugins?: unknown[];
};

const readText = (rel: string): string =>
  fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");

const readAppJson = (): AppJson => JSON.parse(readText("app.json")) as AppJson;

const pluginName = (plugin: unknown): string | null => {
  if (typeof plugin === "string") return plugin;
  if (Array.isArray(plugin) && typeof plugin[0] === "string") return plugin[0];
  return null;
};

const ORIGINAL_ENV = process.env;

// Release-bound guards in app.config.js throw without these; local resolution
// (no EAS_BUILD_PROFILE / VERCEL_ENV) is what this guard needs.
const resolveConfig = (env: Record<string, string | undefined>): ResolvedConfig => {
  jest.resetModules();
  const nextEnv: NodeJS.ProcessEnv = { ...ORIGINAL_ENV };
  delete nextEnv.EAS_BUILD_PROFILE;
  delete nextEnv.VERCEL_ENV;
  delete nextEnv.MINGLA_TAP_TO_PAY_ENTITLEMENT;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete nextEnv[key];
    else nextEnv[key] = value;
  }
  process.env = nextEnv;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const configFn = require(path.join(BIZ_ROOT, "app.config.js")) as (ctx: {
    config: AppJson["expo"];
  }) => ResolvedConfig;
  return configFn({ config: readAppJson().expo });
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

const walkSource = (relDir: string, out: string[]): void => {
  const abs = path.join(BIZ_ROOT, relDir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.name === "__tests__") continue;
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      walkSource(rel, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|swift|m|mm|h|kt|java|json|podspec|xml|plist)$/.test(entry.name)) {
      out.push(rel);
    }
  }
};

describe("ORCH-1248 NFC library stays removed (Apple 2.1)", () => {
  test("package.json declares NO react-native-nfc-manager dependency", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["react-native-nfc-manager"]).toBeUndefined();
    expect(pkg.devDependencies?.["react-native-nfc-manager"]).toBeUndefined();
  });

  test("package.json contains NO nfc-manager string anywhere (incl. doctor exclude)", () => {
    expect(readText("package.json")).not.toMatch(/nfc-manager/i);
  });

  test("package-lock.json is pruned of react-native-nfc-manager", () => {
    expect(readText("package-lock.json")).not.toMatch(/nfc-manager/i);
  });

  test("Mingla's own code and config never use CoreNFC or NFC tag-reading entitlements", () => {
    const files: string[] = ["app.json", "app.config.js"];
    for (const dir of ["app", "src", "plugins", "modules"]) walkSource(dir, files);
    const offenders = files.filter((rel) =>
      /CoreNFC|NFCNDEFReaderSession|NFCTagReaderSession|com\.apple\.developer\.nfc\.readersession/.test(
        readText(rel),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("#4271 android.permission.NFC only through Stripe Terminal", () => {
  test("app.json declares NO android.permission.NFC and does not block it", () => {
    const android = readAppJson().expo.android ?? {};
    expect(android.permissions ?? []).not.toContain(NFC_PERMISSION);
    // Blocking it would strip the Terminal library's NFC and break Tap to Pay.
    expect(android.blockedPermissions ?? []).not.toContain(NFC_PERMISSION);
  });

  test("app.config.js and local config plugins never declare android.permission.NFC", () => {
    const files: string[] = ["app.config.js"];
    walkSource("plugins", files);
    for (const rootFile of fs.readdirSync(BIZ_ROOT)) {
      if (/^with.*\.js$/.test(rootFile)) files.push(rootFile);
    }
    const offenders = files.filter((rel) => readText(rel).includes(NFC_PERMISSION));
    expect(offenders).toEqual([]);
  });

  test("the resolved config adds no NFC permission of its own", () => {
    const resolved = resolveConfig({});
    expect(resolved.android?.permissions ?? []).not.toContain(NFC_PERMISSION);
  });

  test("the Stripe Terminal SDK and its config plugin are the NFC source", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      dependencies?: Record<string, string>;
    };
    // Exact pin: an SDK bump is a deliberate, reviewed change.
    expect(pkg.dependencies?.[TERMINAL_PACKAGE]).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    const resolved = resolveConfig({});
    const terminal = (resolved.plugins ?? []).find(
      (plugin) => pluginName(plugin) === TERMINAL_PACKAGE,
    );
    expect(terminal).toBeDefined();
    const options = (Array.isArray(terminal) ? terminal[1] : {}) as Record<string, unknown>;
    // Required for Tap to Pay on Android (dedicated Tap to Pay process).
    expect(options.appDelegate).toBe(true);
    expect(options.tapToPayCheck).toBe(true);
  });
});

describe("#4271 iOS entitlements", () => {
  test("PassKit / Apple Pay in-app-payments entitlement is UNTOUCHED (real feature)", () => {
    const ent = readAppJson().expo.ios?.entitlements ?? {};
    expect(ent["com.apple.developer.in-app-payments"]).toBeDefined();
  });

  test("app.json never declares the Tap to Pay entitlement directly", () => {
    const ent = readAppJson().expo.ios?.entitlements ?? {};
    expect(ent[TAP_TO_PAY_ENTITLEMENT]).toBeUndefined();
  });

  test("without MINGLA_TAP_TO_PAY_ENTITLEMENT the resolved build has no Tap to Pay entitlement", () => {
    for (const value of [undefined, "0", "true", "yes", ""]) {
      const resolved = resolveConfig({ MINGLA_TAP_TO_PAY_ENTITLEMENT: value });
      expect(resolved.ios?.entitlements?.[TAP_TO_PAY_ENTITLEMENT]).toBeUndefined();
      expect(resolved.ios?.entitlements?.["com.apple.developer.in-app-payments"]).toBeDefined();
    }
  });

  test("MINGLA_TAP_TO_PAY_ENTITLEMENT=1 adds it and keeps every other entitlement", () => {
    const resolved = resolveConfig({ MINGLA_TAP_TO_PAY_ENTITLEMENT: "1" });
    const ent = resolved.ios?.entitlements ?? {};
    expect(ent[TAP_TO_PAY_ENTITLEMENT]).toBe(true);
    expect(ent["com.apple.developer.in-app-payments"]).toEqual(
      readAppJson().expo.ios?.entitlements?.["com.apple.developer.in-app-payments"],
    );
    expect(ent["aps-environment"]).toBe("production");
  });
});

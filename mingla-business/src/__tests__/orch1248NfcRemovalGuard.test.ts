/**
 * ORCH-1248 (Apple 2.1) — the NFC framework was physically removed from the
 * binary (react-native-nfc-manager had ZERO real usage; EAS auto-linked CoreNFC
 * → Apple flagged it). This guard catches any RE-ADD so the framework can never
 * silently return and re-trigger the 2.1 rejection.
 *
 * fails-on-revert: re-adding the dependency, the lockfile pin, or the Android NFC
 * permission makes one of these assertions FAIL.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const BIZ_ROOT = path.join(__dirname, "..", "..");

const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8"));

describe("ORCH-1248 NFC framework removal (Apple 2.1)", () => {
  test("package.json declares NO react-native-nfc-manager dependency", () => {
    const pkg = readJson("package.json") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["react-native-nfc-manager"]).toBeUndefined();
    expect(pkg.devDependencies?.["react-native-nfc-manager"]).toBeUndefined();
  });

  test("package.json contains NO nfc-manager string anywhere (incl. doctor exclude)", () => {
    const raw = fs.readFileSync(path.join(BIZ_ROOT, "package.json"), "utf8");
    expect(raw).not.toMatch(/nfc-manager/i);
  });

  test("package-lock.json is pruned of react-native-nfc-manager", () => {
    const raw = fs.readFileSync(path.join(BIZ_ROOT, "package-lock.json"), "utf8");
    expect(raw).not.toMatch(/nfc-manager/i);
  });

  test("app.json declares NO android.permission.NFC", () => {
    const app = readJson("app.json") as {
      expo?: { android?: { permissions?: string[] } };
    };
    const perms = app.expo?.android?.permissions ?? [];
    expect(perms).not.toContain("android.permission.NFC");
  });

  test("PassKit / Apple Pay in-app-payments entitlement is UNTOUCHED (real feature)", () => {
    const app = readJson("app.json") as {
      expo?: { ios?: { entitlements?: Record<string, unknown> } };
    };
    const ent = app.expo?.ios?.entitlements ?? {};
    expect(ent["com.apple.developer.in-app-payments"]).toBeDefined();
  });
});

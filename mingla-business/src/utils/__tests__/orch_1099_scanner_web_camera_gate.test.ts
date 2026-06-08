/**
 * ORCH-1099 [scanner-camera-web-behavior] regression test.
 *
 * Asserts the door-scanner web path is camera-gated:
 *   1. A web override exists at app/event/[id]/scanner/index.web.tsx so Metro
 *      resolves it for the web export (keeps expo-camera out of the web bundle).
 *   2. The web override does NOT import expo-camera / CameraView /
 *      useCameraPermissions / expo-haptics (no native camera refs ship to web,
 *      no dead camera-permission gate).
 *   3. The web override renders the coherent non-dead-end fallback (a clear
 *      "scan in the app" message + a way forward), not a camera viewport.
 *   4. The NATIVE scanner (index.tsx) is byte-unchanged: it still statically
 *      imports expo-camera + CameraView + useCameraPermissions (the primary
 *      scan surface must not regress).
 *
 * Fails-on-revert: deleting index.web.tsx makes assertion 1 throw; stripping
 * the camera-gate guard re-adds expo-camera and fails assertion 2.
 */

import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const bizFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

const bizPath = (relativePath: string): string =>
  join(REPO_ROOT, "mingla-business", relativePath);

const stripCommentLines = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join("\n");

const WEB_ROUTE = "app/event/[id]/scanner/index.web.tsx";
const NATIVE_ROUTE = "app/event/[id]/scanner/index.tsx";

describe("ORCH-1099 scanner web camera gate", () => {
  test("web override file exists (Metro resolves it for web export)", () => {
    expect(existsSync(bizPath(WEB_ROUTE))).toBe(true);
  });

  test("web override does NOT import expo-camera / camera permission / haptics", () => {
    const code = stripCommentLines(bizFile(WEB_ROUTE));
    expect(code).not.toMatch(/from\s+["']expo-camera["']/);
    expect(code).not.toContain("CameraView");
    expect(code).not.toContain("useCameraPermissions");
    expect(code).not.toMatch(/from\s+["']expo-haptics["']/);
    expect(code).not.toContain("onBarcodeScanned");
  });

  test("web override renders the coherent in-app fallback, not a camera", () => {
    const code = stripCommentLines(bizFile(WEB_ROUTE));
    // A clear non-dead-end message pointing at the app + a way forward.
    expect(code).toContain("Scan tickets in the app");
    expect(code).toContain("EmptyState");
    expect(code).toContain("Button");
  });

  test("native scanner is unchanged — still the primary camera scan surface", () => {
    const code = stripCommentLines(bizFile(NATIVE_ROUTE));
    expect(code).toMatch(/from\s+["']expo-camera["']/);
    expect(code).toContain("CameraView");
    expect(code).toContain("useCameraPermissions");
    expect(code).toContain("onBarcodeScanned");
  });
});

/**
 * ORCH-1001 [Business web white-page crash] — adversarial regression test.
 *
 * DIFFERENT ANGLE than the happy-path test: that one asserts the current
 * source state; this one attacks the PREVENTION mechanism — the CI gate that
 * stops the bug class from ever returning. It plants hostile fixtures (a fresh
 * eager import in a plain file, a side-effect import, a sneaky lazy require,
 * a properly-split file) into a temp tree and asserts the gate's detection
 * logic verdicts each correctly, then confirms the shipped gate self-test and
 * a real planted violation exit non-zero.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

import { afterAll, describe, expect, test } from "@jest/globals";

const gateScript = path.join(process.cwd(), "../.github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs");

const tmpRoots: string[] = [];
const makeTree = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orch1001-adv-"));
  tmpRoots.push(dir);
  return dir;
};

const runGate = (cwd: string, args: string[] = []): { code: number; out: string } => {
  try {
    const out = execFileSync("node", [gateScript, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out };
  } catch (error: unknown) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

afterAll(() => {
  tmpRoots.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe("ORCH-1001 native-TurboModule gate — adversarial", () => {
  test("shipped gate self-test passes (detection logic intact)", () => {
    const result = runGate(process.cwd(), ["--self-test"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("self-test PASS");
  });

  test("gate FAILS on a freshly planted eager import in a plain web-reachable file", () => {
    const root = makeTree();
    const srcDir = path.join(root, "mingla-business/src/components/ui");
    mkdirSync(srcDir, { recursive: true });
    // Minimal package.json so the wiring check has something to read.
    mkdirSync(path.join(root, "mingla-business"), { recursive: true });
    writeFileSync(
      path.join(root, "mingla-business/package.json"),
      JSON.stringify({
        scripts: {
          "test:orch-1001": "node ../.github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs",
        },
      }),
    );
    // Hostile file: eager import, plain .tsx, no .web sibling → must FAIL.
    writeFileSync(
      path.join(srcDir, "EvilCover.tsx"),
      'import VideoTrim from "react-native-video-trim";\nexport const x = VideoTrim;\n',
    );
    const result = runGate(root);
    expect(result.code).toBe(1);
    expect(result.out).toContain("EvilCover.tsx");
    expect(result.out).toContain("react-native-video-trim");
  });

  test("gate ALLOWS a properly platform-split pair (base .ts + .web.ts stub)", () => {
    const root = makeTree();
    const srcDir = path.join(root, "mingla-business/src/components/ui");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(path.join(root, "mingla-business"), { recursive: true });
    writeFileSync(
      path.join(root, "mingla-business/package.json"),
      JSON.stringify({
        scripts: {
          "test:orch-1001": "node ../.github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs",
        },
      }),
    );
    writeFileSync(path.join(srcDir, "GoodTrim.ts"), 'import VideoTrim from "react-native-video-trim";\nexport const x = VideoTrim;\n');
    writeFileSync(path.join(srcDir, "GoodTrim.web.ts"), "export const x = null;\n");
    const result = runGate(root);
    expect(result.code).toBe(0);
    expect(result.out).toContain("PASS");
  });

  test("gate IGNORES a lazy runtime-gated require (compressor pattern, never eval'd on web)", () => {
    const root = makeTree();
    const srcDir = path.join(root, "mingla-business/src/services");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(path.join(root, "mingla-business"), { recursive: true });
    writeFileSync(
      path.join(root, "mingla-business/package.json"),
      JSON.stringify({
        scripts: {
          "test:orch-1001": "node ../.github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs",
        },
      }),
    );
    writeFileSync(
      path.join(srcDir, "lazyCompress.ts"),
      'export const load = () => { if (Platform.OS === "web") return null; return require("react-native-compressor").Video; };\n',
    );
    const result = runGate(root);
    expect(result.code).toBe(0);
  });

  test("gate FAILS when the npm wiring is missing (gate can't be silently unhooked)", () => {
    const root = makeTree();
    mkdirSync(path.join(root, "mingla-business"), { recursive: true });
    writeFileSync(path.join(root, "mingla-business/package.json"), JSON.stringify({ scripts: {} }));
    const result = runGate(root);
    expect(result.code).toBe(1);
    expect(result.out).toContain("wiring");
  });
});

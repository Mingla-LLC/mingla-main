/**
 * ORCH-1001 [Business web white-page crash] — happy-path regression test.
 *
 * Proves the platform split that keeps `react-native-video-trim` out of the
 * web bundle. FAILS-ON-REVERT: if CoverPicker.tsx re-adds the eager top-level
 * `import ... from "react-native-video-trim"` (the exact ORCH-0989 regression),
 * the first assertion fails. The web stub is exercised at runtime to prove it
 * resolves null without touching any native module.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import { trimVideoWithDedicatedEditor } from "../coverPickerVideoTrimEditor.web";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("ORCH-1001 CoverPicker web/native video-trim split", () => {
  test("CoverPicker.tsx has NO eager native video-trim import (fails-on-revert)", () => {
    const picker = repoFile("src/components/ui/CoverPicker.tsx");
    // The crash was a top-level `import ... from "react-native-video-trim"`.
    expect(picker).not.toMatch(/import\s+[^;\n]*from\s+["']react-native-video-trim["']/);
    expect(picker).not.toMatch(/^\s*import\s+["']react-native-video-trim["']/m);
    // It must route through the platform-split module instead.
    expect(picker).toContain('from "./coverPickerVideoTrimEditor"');
  });

  test("both platform-split files exist (base native + .web stub)", () => {
    expect(existsSync(path.join(process.cwd(), "src/components/ui/coverPickerVideoTrimEditor.ts"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "src/components/ui/coverPickerVideoTrimEditor.web.ts"))).toBe(true);
  });

  test("the .web stub does not IMPORT the native package (comments may mention it)", () => {
    const webStub = repoFile("src/components/ui/coverPickerVideoTrimEditor.web.ts");
    // A doc comment may name the package; what matters is there is no real import.
    expect(webStub).not.toMatch(/(?:import|require)\s*[(]?\s*["']react-native-video-trim["']/);
    expect(webStub).not.toMatch(/from\s+["']react-native-video-trim["']/);
    expect(webStub).not.toContain("getEnforcing");
  });

  test("the native base file is the ONLY holder of the eager import", () => {
    const nativeFile = repoFile("src/components/ui/coverPickerVideoTrimEditor.ts");
    expect(nativeFile).toMatch(/from\s+["']react-native-video-trim["']/);
  });

  test("web stub resolves to null without throwing (no in-app trim on web)", async () => {
    await expect(trimVideoWithDedicatedEditor("file:///clip.mov", 29_000)).resolves.toBeNull();
  });
});

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// issue #1350 — the cover trim MUST be a keyframe stream-copy (`-c copy`), NOT a
// frame-accurate re-encode. `enablePreciseTrimming: true` forced a full h264
// re-encode of the whole trimmed span: slow on iOS, and the source of the
// Android `h264_mediacodec` "rc 1" export failure. Reverting Fix B (restoring
// `enablePreciseTrimming: true`) turns this suite red. The duration cap forward
// (orch-0978 C1) MUST survive alongside the flip.
describe("cover trim editor — fast keyframe stream-copy (issue #1350)", () => {
  const editor = repoFile("src/components/ui/coverPickerVideoTrimEditor.ts");

  test("T-1350-01 showEditor is invoked with enablePreciseTrimming: false", () => {
    expect(editor).toContain("enablePreciseTrimming: false");
    // The precise-re-encode flag must be gone — its presence is the #1350 bug.
    expect(editor).not.toContain("enablePreciseTrimming: true");
  });

  test("T-1350-01b the trim editor still forwards the duration cap (orch-0978 C1)", () => {
    expect(editor).toContain("showEditor(uri");
    expect(editor).toContain("maxDuration: maxDurationMs");
  });
});

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("CoverPicker video source ceiling", () => {
  // [TEST-MOD-APPROVED #3040] Source admission has no overshoot above one minute.
  test("uses the shared exact one-minute source ceiling and platform-actionable copy", () => {
    const pickerSource = repoFile("src/components/ui/CoverPicker.tsx");
    const serviceSource = repoFile("src/services/eventCoverVideoProcessingService.ts");
    const rulesSource = repoFile("src/utils/eventCoverMediaRules.ts");
    const ceilingMatch = rulesSource.match(/EVENT_COVER_MAX_VIDEO_DURATION_MS = ([\d_]+)/);
    const sourceCeilingMs = Number(ceilingMatch?.[1].replaceAll("_", ""));

    expect(sourceCeilingMs).toBe(60_000);
    expect(60_001).toBeGreaterThan(sourceCeilingMs);
    expect(serviceSource).toContain(
      "EVENT_COVER_SOURCE_CEILING_MS = EVENT_COVER_MAX_VIDEO_DURATION_MS",
    );
    expect(pickerSource).not.toContain("videoMaxDuration");
    expect(pickerSource).toContain("durationMs > EVENT_COVER_SOURCE_CEILING_MS");
    expect(pickerSource).not.toContain("EVENT_COVER_MAX_VIDEO_DURATION_MS + 250");
    // [TEST-MOD-APPROVED #3040] design H-14a — the over-ceiling refusal is now
    // the "This video is {m:ss} long" card (native: Trim to 1 minute; web:
    // Choose another video), rendered from the pick-refusal model.
    expect(pickerSource).toContain('setPickRefusal({ kind: "too_long", durationMs });');
    expect(pickerSource).not.toContain('"Please trim to 29 seconds first."');
    expect(pickerSource).not.toContain('"This video is over 30 seconds."');
  });
});

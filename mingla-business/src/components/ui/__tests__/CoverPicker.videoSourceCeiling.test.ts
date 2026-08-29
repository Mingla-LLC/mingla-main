import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("CoverPicker video source ceiling", () => {
  // [TEST-MOD-APPROVED #2715] Source admission has no overshoot above 15 seconds.
  test("uses the shared exact 15-second source ceiling and platform-actionable copy", () => {
    const pickerSource = repoFile("src/components/ui/CoverPicker.tsx");
    const serviceSource = repoFile("src/services/eventCoverVideoProcessingService.ts");
    const rulesSource = repoFile("src/utils/eventCoverMediaRules.ts");
    const ceilingMatch = rulesSource.match(/EVENT_COVER_MAX_VIDEO_DURATION_MS = ([\d_]+)/);
    const sourceCeilingMs = Number(ceilingMatch?.[1].replaceAll("_", ""));

    expect(sourceCeilingMs).toBe(15_000);
    expect(15_001).toBeGreaterThan(sourceCeilingMs);
    expect(serviceSource).toContain(
      "EVENT_COVER_SOURCE_CEILING_MS = EVENT_COVER_MAX_VIDEO_DURATION_MS",
    );
    expect(pickerSource).not.toContain("videoMaxDuration");
    expect(pickerSource).toContain("durationMs > EVENT_COVER_SOURCE_CEILING_MS");
    expect(pickerSource).not.toContain("EVENT_COVER_MAX_VIDEO_DURATION_MS + 250");
    expect(pickerSource).toContain('"Trim it to 15 seconds or less, then choose it again."');
    expect(pickerSource).toContain('"Choose a video that is 15 seconds or shorter."');
    expect(pickerSource).not.toContain('"Please trim to 29 seconds first."');
    expect(pickerSource).not.toContain('"This video is over 30 seconds."');
  });
});

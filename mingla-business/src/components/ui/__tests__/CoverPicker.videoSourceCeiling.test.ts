import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("CoverPicker video source ceiling", () => {
  test("accepts keyframe overshoot up to the 33s source ceiling", () => {
    const pickerSource = repoFile("src/components/ui/CoverPicker.tsx");
    const serviceSource = repoFile("src/services/eventCoverVideoProcessingService.ts");
    const ceilingMatch = serviceSource.match(/EVENT_COVER_SOURCE_CEILING_MS = ([\d_]+)/);
    const sourceCeilingMs = Number(ceilingMatch?.[1].replaceAll("_", ""));

    expect(sourceCeilingMs).toBe(33_000);
    expect(30_500).toBeLessThanOrEqual(sourceCeilingMs);
    expect(34_000).toBeGreaterThan(sourceCeilingMs);
    expect(pickerSource).not.toContain("videoMaxDuration");
    expect(pickerSource).toContain("durationMs > EVENT_COVER_SOURCE_CEILING_MS");
    expect(pickerSource).not.toContain("EVENT_COVER_MAX_VIDEO_DURATION_MS + 250");
    expect(pickerSource).toContain('onShowToast("Please trim to 29 seconds first.")');
  });
});

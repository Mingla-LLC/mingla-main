import { readFileSync } from "fs";
import path from "path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  EVENT_COVER_WEB_SOURCE_DURATION_TOLERANCE_MS,
  resolveRawCoverClipDurationMs,
} from "../../../utils/eventCoverMediaRules";
import { normalizePickerDurationMs } from "../coverPickerVideoTrimUpload";
import { createEventCoverVideoUploadIntent } from "../../../services/eventCoverVideoProcessingService";

// The network boundary only: the REAL upload-intent service builds the request.
// The stand-in server answers with the strict 15000 ms rule (`serverAccepts`
// below), so a declared duration above the ceiling is refused the way the edge
// function refuses it.
type IntentBody = { sourceDurationMs: number; trimStartMs: number; trimEndMs: number };
const sentIntentBodies: IntentBody[] = [];
jest.mock("../../../services/supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: "token-3040" } }, error: null }),
    },
    functions: {
      invoke: (_name: string, options: { body: IntentBody }) => {
        sentIntentBodies.push(options.body);
        const accepted = serverAccepts({
          durationMs: options.body.sourceDurationMs,
          trimStartMs: options.body.trimStartMs,
          trimEndMs: options.body.trimEndMs,
        });
        return Promise.resolve({
          data: accepted
            ? { jobId: "job-3040", upload: { url: "https://upload.invalid/3040", fields: {} } }
            : { error: "validation_error", detail: "source_duration_out_of_range" },
          error: null,
        });
      },
    },
  },
}));
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../../../utils/platformFileSystem", () => ({
  getFileInfoAsync: () => Promise.resolve({ exists: false }),
}));

// issue #3040 — a phone "15 second" clip is 450 frames at 29.97 fps = 15.015 s.
// The web picker has no trimmer, so the strict ceiling refused every such clip
// with "Choose a video that is 15 seconds or shorter." Web now accepts a source
// up to 15.5 s and declares it as exactly 15000 ms. Server rules are unchanged.

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// Mirrors the raw (untrimmed) branch of CoverPicker's video pick: the values
// that become the upload intent's sourceDurationMs / trimEndMs.
const rawClipIntent = (
  pickerDuration: number,
  isWeb: boolean,
): { durationMs: number; trimStartMs: number; trimEndMs: number } => {
  const sourceDurationMs = normalizePickerDurationMs(pickerDuration);
  const rawClipDurationMs = resolveRawCoverClipDurationMs(sourceDurationMs, isWeb);
  return { durationMs: rawClipDurationMs, trimStartMs: 0, trimEndMs: rawClipDurationMs };
};

// The picker's own admission rule, verbatim: `durationMs > ceiling` is refused.
const pickerRefuses = (durationMs: number): boolean =>
  durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS;

// The server's rules the declared values must satisfy, restated from
// supabase/functions/_shared/eventCoverVideo.ts `validateTrimRange`, the
// upload-intent source ceiling and the database check (all strict 15000 ms).
const serverAccepts = (intent: {
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
}): boolean =>
  intent.durationMs > 0 &&
  intent.durationMs <= 15_000 &&
  intent.trimStartMs === 0 &&
  intent.trimEndMs > intent.trimStartMs &&
  intent.trimEndMs - intent.trimStartMs <= 15_000 &&
  intent.trimEndMs <= intent.durationMs + 250 &&
  intent.trimEndMs === intent.durationMs;

describe("issue #3040 — web cover video 15-second tolerance", () => {
  test("a 15.015 s clip is accepted on web and the intent carries 15000", () => {
    const intent = rawClipIntent(15_015, true);

    expect(intent).toEqual({ durationMs: 15_000, trimStartMs: 0, trimEndMs: 15_000 });
    expect(pickerRefuses(intent.durationMs)).toBe(false);
    expect(serverAccepts(intent)).toBe(true);
  });

  test("the tolerance is one named constant of 500 ms and is inclusive at 15.5 s", () => {
    expect(EVENT_COVER_WEB_SOURCE_DURATION_TOLERANCE_MS).toBe(500);
    expect(resolveRawCoverClipDurationMs(15_001, true)).toBe(15_000);
    expect(resolveRawCoverClipDurationMs(15_500, true)).toBe(15_000);
  });

  test("a web clip beyond the tolerance is still refused", () => {
    const intent = rawClipIntent(15_501, true);

    expect(intent.durationMs).toBe(15_501);
    expect(pickerRefuses(intent.durationMs)).toBe(true);
  });

  test("clips at or under 15 s are declared with their real duration", () => {
    expect(rawClipIntent(15_000, true).durationMs).toBe(15_000);
    expect(rawClipIntent(8_040, true).durationMs).toBe(8_040);
    expect(rawClipIntent(14_833, true).trimEndMs).toBe(14_833);
  });

  test("native is unchanged: an over-ceiling clip is never clamped", () => {
    expect(resolveRawCoverClipDurationMs(15_015, false)).toBe(15_015);
    expect(pickerRefuses(rawClipIntent(15_015, false).durationMs)).toBe(true);
  });

  test("the picker's raw branch declares the clamped value, and native still trims on the strict ceiling", () => {
    const pickerSource = repoFile("src/components/ui/CoverPicker.tsx");

    expect(pickerSource).toMatch(
      /const rawClipDurationMs = resolveRawCoverClipDurationMs\(\s*sourceDurationMs,\s*Platform\.OS === "web",\s*\);/,
    );
    expect(pickerSource).toContain("durationMs: rawClipDurationMs,");
    expect(pickerSource).toContain("trimEndMs: rawClipDurationMs,");
    // Native over-ceiling clips still go to the trimmer, on the strict ceiling.
    expect(pickerSource).toMatch(
      /const needsNativeTrim =\s*isNative && sourceDurationMs > EVENT_COVER_SOURCE_CEILING_MS;/,
    );
    // The refusal itself is untouched.
    expect(pickerSource).toContain("durationMs > EVENT_COVER_SOURCE_CEILING_MS");
    expect(pickerSource).toContain('"Choose a video that is 15 seconds or shorter."');
  });

  test("the server, edge and client ceilings all stay at a strict 15000 ms", () => {
    const shared = repoFile("../supabase/functions/_shared/eventCoverVideo.ts");

    expect(EVENT_COVER_MAX_VIDEO_DURATION_MS).toBe(15_000);
    expect(shared).toContain('Deno.env.get("EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS") ?? "15000"');
    expect(shared).toContain('Deno.env.get("EVENT_COVER_MAX_DURATION_MS") ?? "15000"');
    expect(shared).toContain("input.trimEndMs - input.trimStartMs > MAX_DURATION_MS");
  });
});

// The picked clip is sent through the REAL client upload-intent service; only
// the network is a stand-in. This is the request a host's browser makes.
describe("issue #3040 — the upload request a 15.015 s web clip produces", () => {
  beforeEach(() => {
    sentIntentBodies.length = 0;
  });

  const requestIntent = (intent: {
    durationMs: number;
    trimStartMs: number;
    trimEndMs: number;
  }): Promise<{ jobId: string }> =>
    createEventCoverVideoUploadIntent({
      applyMode: "draft_auto",
      brandId: "brand-3040",
      eventId: "30400000-0000-4000-8000-000000000001",
      sourceBytes: 4_200_000,
      sourceDurationMs: intent.durationMs,
      sourceMimeType: "video/mp4",
      trimStartMs: intent.trimStartMs,
      trimEndMs: intent.trimEndMs,
    });

  test("web: the server is asked for exactly 15000 ms and accepts the clip", async () => {
    const intent = rawClipIntent(15_015, true);
    const accepted = await requestIntent(intent);

    expect(accepted.jobId).toBe("job-3040");
    expect(sentIntentBodies).toHaveLength(1);
    expect(sentIntentBodies[0]).toMatchObject({
      sourceDurationMs: 15_000,
      trimStartMs: 0,
      trimEndMs: 15_000,
    });
  });

  test("every clip inside the tolerance is accepted, the last one at 15.5 s", async () => {
    for (const pickerDuration of [15_001, 15_015, 15_033, 15_250, 15_500]) {
      const accepted = await requestIntent(rawClipIntent(pickerDuration, true));
      expect(accepted.jobId).toBe("job-3040");
    }
    expect(sentIntentBodies.map((body) => body.sourceDurationMs)).toEqual([
      15_000, 15_000, 15_000, 15_000, 15_000,
    ]);
  });

  test("the undeclared 15015 is what the server refuses: the reported failure, reproduced", async () => {
    // What the picker declared before the fix (and what native still declares
    // for a raw clip, which is why native sends it to the trimmer instead).
    const unclamped = rawClipIntent(15_015, false);
    expect(unclamped.durationMs).toBe(15_015);

    let refusal: unknown = null;
    try {
      await requestIntent(unclamped);
    } catch (caught) {
      refusal = caught;
    }
    expect(refusal).toMatchObject({
      edgeError: "validation_error",
      edgeDetail: "source_duration_out_of_range",
    });
    expect(sentIntentBodies[0].sourceDurationMs).toBe(15_015);
  });
});

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";
import ts from "typescript";

import * as rules from "../../../utils/eventCoverMediaRules";
import {
  buildTrimmedVideoUploadFile,
  normalizePickerDurationMs,
} from "../coverPickerVideoTrimUpload";

// issue #3040 — tester adversarial pass. The implementor's test checks the
// headline values (15015, 15001, 15500, 15501) against a RESTATED copy of the
// server rule. This file attacks different angles:
//   1. the REAL server functions (`validateTrimRange`, `assertProcessedDerivative`)
//      are lifted out of supabase/functions/_shared/eventCoverVideo.ts and run,
//      so a drift in the server rule cannot hide behind a hand-copied predicate;
//   2. every whole millisecond of the tolerance band, plus fractional picker
//      durations on both sides of each boundary, must produce an integer that
//      is never above 15000;
//   3. unreadable durations (NaN, Infinity, 0, negative, undefined) must never
//      be turned into an acceptable clip by the clamp;
//   4. native never receives the tolerance anywhere in the band;
//   5. the trimmed branch never consumes the clamped value;
//   6. the late-failure risk: what the transcoder webhook does with a clip that
//      really is longer than 15 s.

type ResolveFn = (sourceDurationMs: number, isWeb: boolean) => number;

// Looked up dynamically so that, with the fix reverted, this file still loads
// and each case fails on its own assertion instead of on a missing import.
const resolveRaw = (sourceDurationMs: number, isWeb: boolean): number => {
  const fn = (rules as unknown as { resolveRawCoverClipDurationMs?: ResolveFn })
    .resolveRawCoverClipDurationMs;
  // Reverted behaviour: the picker declared the normalised duration untouched.
  return typeof fn === "function" ? fn(sourceDurationMs, isWeb) : sourceDurationMs;
};

const CEILING_MS = rules.EVENT_COVER_MAX_VIDEO_DURATION_MS;

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const sharedSource = repoFile("../supabase/functions/_shared/eventCoverVideo.ts");

// Lift one exported function out of the Deno module and run it under jest.
const liftServerFunction = <T>(name: string, scope: Record<string, unknown>): T => {
  const start = sharedSource.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`server function ${name} not found`);
  const end = sharedSource.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`server function ${name} has no end`);
  const tsBody = sharedSource.slice(start, end + 2).replace("export function", "function");
  const js = ts.transpileModule(tsBody, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const names = Object.keys(scope);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(...names, `${js}\nreturn ${name};`);
  return factory(...names.map((key) => scope[key])) as T;
};

type TrimVerdict = { status: number; body: { detail?: string } } | null;

const validateTrimRange = liftServerFunction<
  (input: {
    sourceDurationMs: number | null;
    trimStartMs: number;
    trimEndMs: number;
  }) => TrimVerdict
>("validateTrimRange", {
  MAX_DURATION_MS: 15_000,
  jsonResponse: (body: unknown, status = 200) => ({ body, status }),
});

const assertProcessedDerivative = liftServerFunction<
  (input: {
    url: unknown;
    mimeType: unknown;
    bytes: unknown;
    durationMs: unknown;
    videoCodec?: unknown;
  }) => { ok: boolean; code?: string }
>("assertProcessedDerivative", {
  MAX_DURATION_MS: 15_000,
  FINAL_MAX_BYTES: 100 * 1024 * 1024,
});

// The values CoverPicker's raw branch puts on the upload file.
const webRawIntent = (pickerDuration: unknown) => {
  const sourceDurationMs = normalizePickerDurationMs(pickerDuration as number);
  const declared = resolveRaw(sourceDurationMs, true);
  return { sourceDurationMs: declared, trimStartMs: 0, trimEndMs: declared };
};

// Every rule a declared raw clip must clear before a job row exists: the
// upload-intent source ceiling, the real validateTrimRange, and the database
// trigger (trim_start_ms = 0, trim_end_ms = source_duration_ms, <= 15000,
// integer columns).
const serverRefusal = (intent: {
  sourceDurationMs: number;
  trimStartMs: number;
  trimEndMs: number;
}): string | null => {
  if (!Number.isInteger(intent.sourceDurationMs)) return "non_integer_column";
  if (!Number.isFinite(intent.sourceDurationMs) || intent.sourceDurationMs <= 0) {
    return "source_duration_out_of_range";
  }
  if (intent.sourceDurationMs > 15_000) return "source_duration_out_of_range";
  const trim = validateTrimRange(intent);
  if (trim !== null) return trim.body.detail ?? "trim_refused";
  if (intent.trimStartMs !== 0 || intent.trimEndMs !== intent.sourceDurationMs) {
    return "db_trim_end_must_equal_source_duration";
  }
  return null;
};

describe("issue #3040 tester — the lifted server rule is the real one", () => {
  test("validateTrimRange refuses what the real intent endpoint refuses", () => {
    expect(validateTrimRange({ sourceDurationMs: 15_000, trimStartMs: 0, trimEndMs: 15_000 })).toBeNull();
    expect(
      validateTrimRange({ sourceDurationMs: 15_015, trimStartMs: 0, trimEndMs: 15_015 })?.body.detail,
    ).toBe("trim_over_duration");
    expect(
      validateTrimRange({ sourceDurationMs: 15_000, trimStartMs: 0, trimEndMs: Number.NaN })?.body.detail,
    ).toBe("trim_invalid");
    expect(
      validateTrimRange({ sourceDurationMs: 9_000, trimStartMs: 0, trimEndMs: 9_251 })?.body.detail,
    ).toBe("trim_out_of_range");
  });

  test("the database trigger still demands trim_end_ms = source_duration_ms and <= 15000", () => {
    const migration = repoFile(
      "../supabase/migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql",
    );
    expect(migration).toContain("NEW.source_duration_ms > 15000");
    expect(migration).toContain("NEW.trim_start_ms <> 0 OR NEW.trim_end_ms <> NEW.source_duration_ms");
    expect(migration).toContain("trim_end_ms-trim_start_ms <= 15000");
  });
});

describe("issue #3040 tester — web tolerance band, every millisecond", () => {
  test("every whole ms from 15001 to 15500 is declared as an integer 15000 the server accepts", () => {
    const refused: Array<{ ms: number; why: string }> = [];
    for (let ms = CEILING_MS + 1; ms <= CEILING_MS + 500; ms += 1) {
      const intent = webRawIntent(ms);
      const why = serverRefusal(intent);
      if (why !== null || intent.sourceDurationMs !== CEILING_MS) {
        refused.push({ ms, why: why ?? `declared ${intent.sourceDurationMs}` });
      }
    }
    expect(refused).toEqual([]);
  });

  test("nothing in or around the band ever declares more than 15000 or a non-integer", () => {
    const offenders: number[] = [];
    for (let tenth = 149_900; tenth <= 155_000; tenth += 3) {
      const declared = webRawIntent(tenth / 10).sourceDurationMs;
      if (!Number.isInteger(declared) || declared > CEILING_MS) offenders.push(tenth / 10);
    }
    expect(offenders).toEqual([]);
  });

  test("fractional picker durations land on the right side of each boundary", () => {
    // Just over the ceiling by less than half a millisecond: a real 15000.
    expect(webRawIntent(15_000.4).sourceDurationMs).toBe(15_000);
    // Rounds up to 15001: inside the band, clamped.
    expect(webRawIntent(15_000.6).sourceDurationMs).toBe(15_000);
    expect(webRawIntent(15_499.6).sourceDurationMs).toBe(15_000);
    // Rounds DOWN to 15500: still inside the inclusive band.
    expect(webRawIntent(15_500.4).sourceDurationMs).toBe(15_000);
    // Rounds up to 15501: outside, left untouched so the picker refuses it.
    expect(webRawIntent(15_500.5).sourceDurationMs).toBe(15_501);
    expect(webRawIntent(15_501).sourceDurationMs).toBe(15_501);
    expect(serverRefusal(webRawIntent(15_501))).toBe("source_duration_out_of_range");
  });

  test("a duration reported in SECONDS (15.015) is treated like 15015 ms, not waved through as 15 ms", () => {
    expect(normalizePickerDurationMs(15.015)).toBe(15_015);
    expect(webRawIntent(15.015)).toEqual({
      sourceDurationMs: 15_000,
      trimStartMs: 0,
      trimEndMs: 15_000,
    });
    expect(webRawIntent(15.5).sourceDurationMs).toBe(15_000);
    expect(webRawIntent(15.501).sourceDurationMs).toBe(15_501);
  });

  test("the clamp never shortens or lengthens a clip that was already within 15 s", () => {
    for (const ms of [1, 999, 1_000, 8_040, 14_833, 14_999, 15_000]) {
      expect(resolveRaw(ms, true)).toBe(ms);
      expect(resolveRaw(ms, false)).toBe(ms);
    }
  });
});

describe("issue #3040 tester — unreadable durations are never rescued by the clamp", () => {
  test.each([
    ["NaN", Number.NaN],
    ["Infinity (a MediaRecorder WebM)", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["undefined", undefined],
    ["null", null],
    ["a string", "15015"],
    ["zero", 0],
  ])("%s becomes 0, which the picker reports as an unreadable duration", (_label, value) => {
    const intent = webRawIntent(value);
    expect(intent.sourceDurationMs).toBe(0);
    expect(serverRefusal(intent)).not.toBeNull();
  });

  test("a negative duration stays negative and is refused, never clamped up to 15000", () => {
    for (const ms of [-1, -15_015, -15_500]) {
      const intent = webRawIntent(ms);
      expect(intent.sourceDurationMs).toBeLessThanOrEqual(0);
      expect(serverRefusal(intent)).not.toBeNull();
    }
  });

  test("called directly with garbage, the resolver hands it back unchanged", () => {
    expect(Number.isNaN(resolveRaw(Number.NaN, true))).toBe(true);
    expect(resolveRaw(Number.POSITIVE_INFINITY, true)).toBe(Number.POSITIVE_INFINITY);
    expect(resolveRaw(-15_015, true)).toBe(-15_015);
    expect(resolveRaw(0, true)).toBe(0);
  });
});

describe("issue #3040 tester — native never gets the tolerance", () => {
  test("no millisecond of the band is clamped when the platform is not web", () => {
    const clamped: number[] = [];
    for (let ms = CEILING_MS + 1; ms <= CEILING_MS + 600; ms += 1) {
      if (resolveRaw(ms, false) !== ms) clamped.push(ms);
    }
    expect(clamped).toEqual([]);
  });

  test("the trim decision reads the UNCLAMPED source, before the clamp is computed", () => {
    const picker = repoFile("src/components/ui/CoverPicker.tsx");
    const trimDecision = picker.indexOf("const needsNativeTrim =");
    const clamp = picker.indexOf("const rawClipDurationMs =");

    expect(trimDecision).toBeGreaterThan(0);
    expect(clamp).toBeGreaterThan(trimDecision);
    const decisionLine = picker.slice(trimDecision, picker.indexOf(";", trimDecision));
    expect(decisionLine).toContain("isNative && sourceDurationMs > EVENT_COVER_SOURCE_CEILING_MS");
    expect(decisionLine).not.toContain("rawClipDurationMs");
    // The trimmer is still asked for the strict 15000, not ceiling + tolerance.
    expect(picker).toContain(
      "trimVideoWithDedicatedEditor(asset.uri, EVENT_COVER_MAX_VIDEO_DURATION_MS)",
    );
    expect(picker).not.toMatch(/trimVideoWithDedicatedEditor\([^)]*TOLERANCE/);
  });

  test("the clamp is gated on the platform, and is used by exactly the raw branch", () => {
    const picker = repoFile("src/components/ui/CoverPicker.tsx");
    const call = picker.slice(
      picker.indexOf("const rawClipDurationMs ="),
      picker.indexOf("const uploadFile ="),
    );
    expect(call).toMatch(/resolveRawCoverClipDurationMs\(\s*sourceDurationMs,\s*Platform\.OS === "web",?\s*\)/);
    // Declared twice (durationMs, trimEndMs) and nowhere else.
    expect(picker.match(/rawClipDurationMs/g)?.length).toBe(3);
    const trimmedBranch = picker.slice(
      picker.indexOf("? await buildTrimmedVideoUploadFile({"),
      picker.indexOf("bytes: asset.fileSize ?? 0,"),
    );
    expect(trimmedBranch.length).toBeGreaterThan(0);
    expect(trimmedBranch).not.toContain("rawClipDurationMs");
  });

  test("a trimmed clip (trimStart > 0) is declared from the trim window, untouched by the tolerance", async () => {
    const statFile = async () => ({ exists: true, size: 2_000_000 });
    // 15.015 s window starting 4 s in: must stay 15015 so the native refusal
    // ("Trim it to 15 seconds or less") still fires. No tolerance on native.
    const overCap = await buildTrimmedVideoUploadFile({
      trimResult: { startTime: 4_000, endTime: 19_015, outputPath: "/tmp/a.mp4" } as never,
      statFile,
    });
    expect(overCap.durationMs).toBe(15_015);
    expect(overCap.trimStartMs).toBe(0);
    expect(overCap.trimEndMs).toBe(15_015);
    expect(overCap.durationMs > CEILING_MS).toBe(true);

    const withinCap = await buildTrimmedVideoUploadFile({
      trimResult: { startTime: 4_000, endTime: 18_500, outputPath: "/tmp/b.mp4" } as never,
      statFile,
    });
    expect(withinCap.durationMs).toBe(14_500);
    expect(
      serverRefusal({
        sourceDurationMs: withinCap.durationMs,
        trimStartMs: withinCap.trimStartMs ?? -1,
        trimEndMs: withinCap.trimEndMs ?? -1,
      }),
    ).toBeNull();
  });
});

describe("issue #3040 tester — can an accepted clip fail AFTER upload?", () => {
  const derivative = (lengthSeconds: number) =>
    assertProcessedDerivative({
      url: "https://cdn.example.test/play_720p.mp4",
      mimeType: "video/mp4",
      bytes: 5_000_000,
      durationMs: lengthSeconds * 1000,
      videoCodec: "x264",
    });

  test("the webhook builds the processed duration from the provider's whole-second length", () => {
    const webhook = repoFile("../supabase/functions/event-cover-video-webhook/index.ts");
    expect(webhook).toContain("const durationMs = lengthSeconds * 1000;");
    expect(webhook).not.toMatch(/durationMs\s*=\s*existingJob\.(trim_end_ms|source_duration_ms)/);
  });

  test("a length of 15 passes; anything the provider reports above 15 fails the job late", () => {
    // 15.015 s to 15.5 s truncated to whole seconds is 15: accepted.
    expect(derivative(Math.floor(15.015)).ok).toBe(true);
    expect(derivative(Math.floor(15.5)).ok).toBe(true);
    // The hazard, pinned: if the provider ever ROUNDED 15.5 up, or reported
    // fractional seconds, the same accepted clip would fail after upload.
    expect(derivative(16)).toMatchObject({ ok: false, code: "processed_duration_over_cap" });
    expect(derivative(15.015)).toMatchObject({ ok: false, code: "processed_duration_over_cap" });
  });

  test("the tolerance stays under half a second, so even a ROUNDING provider would report 15", () => {
    const tolerance = (rules as unknown as { EVENT_COVER_WEB_SOURCE_DURATION_TOLERANCE_MS?: number })
      .EVENT_COVER_WEB_SOURCE_DURATION_TOLERANCE_MS;
    expect(typeof tolerance).toBe("number");
    expect(tolerance as number).toBeGreaterThanOrEqual(15);
    // Strictly below 500 would survive round-half-up; exactly 500 survives only
    // truncation. Recorded as a boundary the owner should know about.
    expect(tolerance as number).toBeLessThanOrEqual(500);
    expect(Math.floor((CEILING_MS + (tolerance as number)) / 1000)).toBe(15);
  });
});

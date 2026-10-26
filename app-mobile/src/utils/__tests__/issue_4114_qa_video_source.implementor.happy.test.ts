// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2: iPhone chat videos are exported at 720p
// (Seth's call), and a 720p export can be larger than a compact original
// (9.7 MB 1080p HEVC became 13.3 MB). The sent file must never be larger than
// the original: the original wins only when it is strictly smaller AND passes
// the 25 MB / 60 s guards.
//
// FAILS-ON-REVERT: always send the export, send the original when it is
// larger, or send an original above 25 MB / 60 s, and a case fails.

import {
  MAX_ATTACHMENT_BYTES,
  chooseChatVideoSource,
  videoMimeFromHeader,
} from "../chatMedia.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const MB = 1024 * 1024;

Deno.test("QA run 2: a 720p export larger than the original sends the original", () => {
  assertEquals(
    chooseChatVideoSource({ fileSize: 13.3 * MB, durationMs: 12_000 }, { fileSize: 9.7 * MB, durationMs: 12_000 }),
    "original",
    "the evidence clip",
  );
});

Deno.test("QA run 2: a smaller export is sent", () => {
  assertEquals(
    chooseChatVideoSource({ fileSize: 6 * MB, durationMs: 30_000 }, { fileSize: 40 * MB, durationMs: 30_000 }),
    "export",
    "4K original",
  );
  assertEquals(
    chooseChatVideoSource({ fileSize: 8 * MB, durationMs: 10_000 }, { fileSize: 8 * MB, durationMs: 10_000 }),
    "export",
    "equal size keeps the 720p export",
  );
});

Deno.test("QA run 2: the original must pass the 25 MB and 60 s guards", () => {
  assertEquals(
    chooseChatVideoSource({ fileSize: 30 * MB, durationMs: 50_000 }, { fileSize: MAX_ATTACHMENT_BYTES + 1, durationMs: 50_000 }),
    "export",
    "original over 25 MB",
  );
  assertEquals(
    chooseChatVideoSource({ fileSize: 20 * MB, durationMs: 61_000 }, { fileSize: 15 * MB, durationMs: 61_000 }),
    "export",
    "original over 60 s",
  );
  assertEquals(
    chooseChatVideoSource({ fileSize: 20 * MB, durationMs: 60_000 }, { fileSize: 15 * MB, durationMs: 60_000 }),
    "original",
    "60 s exactly is allowed",
  );
});

Deno.test("QA run 2: unknown sizes or no original send the export", () => {
  assertEquals(chooseChatVideoSource({ fileSize: 10 * MB }, null), "export", "no original");
  assertEquals(chooseChatVideoSource({ fileSize: 10 * MB }, { fileSize: null }), "export", "original size unknown");
  assertEquals(chooseChatVideoSource({ fileSize: null }, { fileSize: 5 * MB }), "export", "export size unknown");
  assertEquals(chooseChatVideoSource({ fileSize: 10 * MB }, { fileSize: 0 }), "export", "empty original");
});

Deno.test("QA run 2: the original's container comes from its ftyp header", () => {
  const header = (s: string) => btoa(s);
  assertEquals(videoMimeFromHeader(header("\0\0\0\x14ftypqt  ")), "video/quicktime", "QuickTime");
  assertEquals(videoMimeFromHeader(header("\0\0\0\x18ftypmp42")), "video/mp4", "MP4");
  assertEquals(videoMimeFromHeader(header("\0\0\0\x18moovabcd")), null, "not ISO media");
  assertEquals(videoMimeFromHeader("%%%"), null, "bad base64");
});

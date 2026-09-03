/**
 * Issue #3073 — a "cover video" with no picture must never reach the provider.
 *
 * The trim editor can return a well-formed MP4 that carries ONLY an audio
 * track: `moov` at the front, correct duration, correct byte count. Every size
 * and hash check upstream passes, so the first thing that notices is Bunny,
 * which cannot probe it (`length: 0`, `storageSize: 0`, no resolution ladder)
 * and answers with an `originalHash` over something other than what we sent.
 * The webhook then fails the job `source_identity_mismatch` — a true statement
 * about the hashes and a useless one about the cause. Observed on the iOS
 * Simulator 2026-09-03: three consecutive trims produced 15s / 161,210-byte
 * files whose ffprobe stream list was one AAC track and nothing else.
 *
 * `VideoTrackScan` reads the ISO-BMFF handler boxes out of the bytes that are
 * already being streamed for the hash. This pins the three answers it can give,
 * and in particular that it is biased towards LETTING THE UPLOAD THROUGH: a
 * false negative blocks a host's perfectly good video, which is worse than the
 * status quo.
 *
 * Fails-on-revert:
 *   - Drop the scan -> T-3073-01 stops reporting false for an audio-only moov.
 *   - Make it strict (report false when nothing parsed) -> T-3073-03 fails.
 *   - Drop the carry between chunks -> T-3073-04 fails on a split box.
 */

import { describe, expect, test } from "@jest/globals";

import { VideoTrackScan } from "../eventCoverVideoPreparedSource.native";

const ascii = (text: string): number[] =>
  Array.from(text, (character) => character.charCodeAt(0));

// One `hdlr` box as ISO/IEC 14496-12 §8.4.3 lays it out, offsets from the type
// field: [type 'hdlr' :4][version+flags :4][pre_defined :4][handler_type :4].
const hdlrBox = (handler: "vide" | "soun"): number[] => [
  ...ascii("hdlr"),
  0, 0, 0, 0,
  0, 0, 0, 0,
  ...ascii(handler),
  0, 0, 0, 0,
];

const bytes = (...parts: number[][]): Uint8Array =>
  new Uint8Array(parts.flat());

describe("issue #3073 — refuse a cover video that has no video track", () => {
  test("T-3073-01 an audio-only container reports NO video track", () => {
    const scan = new VideoTrackScan();
    scan.update(bytes(ascii("ftypmp42"), ascii("moov"), hdlrBox("soun")));
    expect(scan.hasVideoTrack()).toBe(false);
  });

  test("T-3073-02 a container with a video handler reports a video track", () => {
    const scan = new VideoTrackScan();
    scan.update(
      bytes(ascii("ftypmp42"), ascii("moov"), hdlrBox("vide"), hdlrBox("soun")),
    );
    expect(scan.hasVideoTrack()).toBe(true);
  });

  test("T-3073-03 an unparseable container reports null, and never blocks", () => {
    const scan = new VideoTrackScan();
    scan.update(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]));
    // null, not false: refusing an upload we could not parse would block good
    // video, which is worse than the bug this guard exists for.
    expect(scan.hasVideoTrack()).toBeNull();
  });

  test("T-3073-04 a handler box split across two chunks is still seen", () => {
    const whole = bytes(ascii("moov"), hdlrBox("vide"));
    const split = 6; // lands mid-'hdlr', inside the 15-byte carry window
    const scan = new VideoTrackScan();
    scan.update(whole.slice(0, split));
    scan.update(whole.slice(split));
    expect(scan.hasVideoTrack()).toBe(true);
  });

  test("T-3073-05 the audio-only verdict survives being fed one byte at a time", () => {
    const whole = bytes(ascii("moov"), hdlrBox("soun"));
    const scan = new VideoTrackScan();
    for (const byte of whole) scan.update(new Uint8Array([byte]));
    expect(scan.hasVideoTrack()).toBe(false);
  });
});

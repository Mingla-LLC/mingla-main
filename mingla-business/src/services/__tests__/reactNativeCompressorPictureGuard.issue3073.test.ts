/**
 * Issue #3073 — `react-native-compressor` must never turn a video into sound.
 *
 * Its iOS exporter (NextLevelSessionExporter) creates the H.264 writer input
 * only when `AVAssetWriter.canApply(outputSettings:)` accepts the settings. When
 * it does not, the library printed "Unsupported output configuration", skipped
 * the video track, exported the audio track alone and reported SUCCESS.
 *
 * Measured on the iOS 26.5 Simulator (2026-09-17) with a standalone harness
 * built from the shipped Swift file and the exact settings `VideoMain.swift`
 * sends: `canApply` is false for bitrate + H264HighAutoLevel + expected FPS +
 * `AVVideoAverageNonDroppableFrameRateKey`, and true as soon as that one key is
 * removed. Every other combination was accepted. On macOS the same settings are
 * accepted, which is why nothing but the Simulator showed it.
 *
 * `patches/react-native-compressor+1.18.2.patch` does two things:
 *   1. retries once without that optional key before giving up on the video;
 *   2. fails the export when the source has a video track and no video input
 *      could be created, so the caller falls back to the original file instead
 *      of receiving a picture-less "success".
 *
 * CI installs with `--ignore-scripts`, so `node_modules` holds the PRISTINE
 * library there (and the patched one wherever postinstall ran). This suite
 * applies the patch to whichever it finds and checks the result, which also
 * catches a library upgrade that leaves the patch behind.
 *
 * Fails on revert: delete the patch, or drop either change from it.
 */
import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..");
const PATCHES_DIR = join(BUSINESS_ROOT, "patches");
const TARGET = "node_modules/react-native-compressor/ios/Video/NextLevelSessionExporter.swift";

const patchFiles = (): string[] =>
  existsSync(PATCHES_DIR)
    ? readdirSync(PATCHES_DIR).filter((name) => name.startsWith("react-native-compressor+"))
    : [];

type Hunk = { before: string[]; after: string[] };

// A minimal unified-diff reader for the one file this patch touches.
const hunksFor = (patch: string, file: string): Hunk[] => {
  const section = patch.split(/^diff --git /m).find((part) => part.startsWith(`a/${file} `));
  if (section === undefined) return [];
  return section
    .split(/^@@[^\n]*@@[^\n]*\n/m)
    .slice(1)
    .map((body) => {
      const lines = body.replace(/\n$/, "").split("\n");
      const before: string[] = [];
      const after: string[] = [];
      for (const line of lines) {
        if (line.startsWith("\\")) continue;
        const marker = line[0];
        const text = line.slice(1);
        if (marker === " " || marker === undefined) {
          before.push(text);
          after.push(text);
        } else if (marker === "-") {
          before.push(text);
        } else if (marker === "+") {
          after.push(text);
        }
      }
      return { before, after };
    });
};

const applyTo = (source: string, hunks: Hunk[]): string =>
  hunks.reduce((current, hunk) => {
    const after = hunk.after.join("\n");
    if (current.includes(after)) return current; // postinstall already applied it
    const before = hunk.before.join("\n");
    if (!current.includes(before)) {
      throw new Error(`patch hunk no longer matches the installed library:\n${before.slice(0, 400)}`);
    }
    return current.replace(before, after);
  }, source);

const lockedCompressorVersion = (): string => {
  const lock = JSON.parse(readFileSync(join(BUSINESS_ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  return lock.packages["node_modules/react-native-compressor"]?.version ?? "";
};

describe("#3073 — react-native-compressor never exports a picture-less video", () => {
  test("exactly one compressor patch exists, for the version the lockfile installs", () => {
    const files = patchFiles();
    expect(files).toEqual([`react-native-compressor+${lockedCompressorVersion()}.patch`]);
  });

  test("the patch applies to the installed exporter and adds both protections", () => {
    const [file] = patchFiles();
    expect(file).toBeDefined();
    const patch = readFileSync(join(PATCHES_DIR, file), "utf8");
    const hunks = hunksFor(patch, TARGET);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    const installed = readFileSync(join(BUSINESS_ROOT, TARGET), "utf8");
    const patched = applyTo(installed, hunks);
    const compact = patched.replace(/\s+/g, " ");

    // 1. Retry without the key the Simulator's H.264 encoder refuses, and build
    //    the writer input from the settings that were actually accepted.
    expect(compact).toContain(
      "compressionProperties.removeValue(forKey: AVVideoAverageNonDroppableFrameRateKey) != nil",
    );
    expect(compact).toContain(
      "self._videoInput = AVAssetWriterInput(mediaType: AVMediaType.video, outputSettings: videoOutputSettings)",
    );
    expect(compact).not.toContain(
      "self._videoInput = AVAssetWriterInput(mediaType: AVMediaType.video, outputSettings: self.videoOutputConfiguration)",
    );

    // 2. A source with a picture and no video input fails the export — before
    //    the audio is set up or anything is written.
    const guard = compact.indexOf(
      "if asset.tracks(withMediaType: AVMediaType.video).count > 0 && self._videoInput == nil {",
    );
    expect(guard).toBeGreaterThan(compact.indexOf("self.setupVideoOutput(withAsset: asset)"));
    expect(guard).toBeLessThan(compact.indexOf("self.setupAudioOutput(withAsset: asset)"));
    const guardBody = compact.slice(guard, compact.indexOf("self.setupAudioOutput(withAsset: asset)"));
    expect(guardBody).toContain(".failure(NextLevelSessionExporterError.setupFailure)");
    expect(guardBody).toContain("return");
  });
});

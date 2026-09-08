/*
 * #2830 — a rejection must name what IS accepted, and must not call a video an
 * image.
 *
 * The old copy said "That image could not be accepted." for every rejection.
 * Video was refused with it while the pipeline behind the gate handled video
 * perfectly well, so the message sent whoever hit it hunting for a problem with
 * their picture. It cost real diagnosis time.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Comments in this file discuss the old copy verbatim, so they are stripped
// before asserting on it.
const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("#2830 media rejection copy", () => {
  it("never calls an arbitrary upload an image", () => {
    expect(source).not.toContain("That image could not be accepted");
  });

  it("names every accepted type, so the rejection is actionable", () => {
    for (const accepted of ["JPEG", "PNG", "WebP", "MP4"]) {
      expect(source).toContain(accepted);
    }
  });

  it("states the size limit the gate actually enforces", () => {
    // MAX_BYTES in mediaPipeline is 20 * 1024 * 1024.
    const pipeline = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/mediaPipeline.ts"),
      "utf8",
    );
    expect(pipeline).toContain("const MAX_BYTES = 20 * 1024 * 1024");
    expect(source).toContain("20MB");
  });
});

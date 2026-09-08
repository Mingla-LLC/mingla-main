/*
 * #2830 — the upload grant must accept the media types the rest of the pipeline
 * can actually process.
 *
 * video/mp4 was supported everywhere downstream and omitted from the one set
 * that gates the front door, so every video upload failed with "that image
 * could not be accepted". Confirmed against production before the fix.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/mediaPipeline.ts"),
  "utf8",
);

// Comments in this file discuss every one of these types by name, so the
// assertions read the ACCEPTED literal itself rather than the whole file.
function acceptedSet(): string[] {
  const match = source.match(/const ACCEPTED = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error("ACCEPTED set not found");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function declaredMimeOptions(): string[] {
  const collection = fs.readFileSync(
    path.resolve(process.cwd(), "src/collections/Media.ts"),
    "utf8",
  );
  const match = collection.match(/name: "declared_mime"[\s\S]*?options: \[([\s\S]*?)\]/);
  if (!match) throw new Error("declared_mime options not found");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("#2830 the upload grant accepts what the pipeline can process", () => {
  it("accepts video/mp4", () => {
    expect(acceptedSet()).toContain("video/mp4");
  });

  it("still accepts the three image types", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      expect(acceptedSet()).toContain(mime);
    }
  });

  it("accepts nothing the media schema would reject", () => {
    // The gate must never be looser than the column it writes into.
    const options = declaredMimeOptions();
    for (const mime of acceptedSet()) expect(options).toContain(mime);
  });

  it("accepts everything the media schema allows", () => {
    // And never tighter, or a supported type is unreachable through the product
    // — which is exactly the bug this file exists for.
    const accepted = acceptedSet();
    for (const mime of declaredMimeOptions()) expect(accepted).toContain(mime);
  });
});

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const ICLOUD_COPY =
  "This video is saved in iCloud. Open it in Photos to download it to your phone, then try again.";
const TRIM_COPY = "Couldn't trim this video. Try another clip.";
const GENERIC_COPY = "Couldn't add this video. Try another clip.";

// issue #1348 — the cover-video pick/trim catch must NEVER surface the raw
// system `error.message` (e.g. "PHPhotosErrorDomain error 3164"). Every failure
// is mapped through `friendlyVideoCoverError`. Reverting Fix C (restoring the
// raw `error.message` fallback) turns this suite red on BOTH the wiring
// assertion and the "old raw fallback literal is gone" assertion.
describe("CoverPicker friendly video-cover error copy (issue #1348)", () => {
  const picker = repoFile("src/components/ui/CoverPicker.tsx");

  const mapperBody = (): string => {
    const start = picker.indexOf("const friendlyVideoCoverError");
    expect(start).toBeGreaterThan(-1);
    // The generic fallback `return` is the LAST statement of the mapper.
    const genericReturn = picker.indexOf(`return "${GENERIC_COPY}";`, start);
    expect(genericReturn).toBeGreaterThan(start);
    return picker.slice(start, genericReturn);
  };

  test("T-1348-00 the video catch routes through the friendly mapper, not error.message", () => {
    // The in-sheet notice text is produced by the mapper ...
    expect(picker).toContain("text: friendlyVideoCoverError(error)");
    // ... and the old raw-message fallback (which leaked "error 3164" verbatim
    // to users) is gone. This literal existed ONLY in the reverted video catch.
    expect(picker).not.toContain("Video cover upload failed. Try again.");
  });

  test("T-1348-01 iCloud / PHPhotosErrorDomain / 3164 route to the iCloud copy", () => {
    const body = mapperBody();
    const lower = body.toLowerCase();
    expect(lower).toContain("phphotoserrordomain");
    expect(body).toContain("3164");
    expect(lower).toContain("networkaccessrequired");
    expect(lower).toContain("icloud");
    // The exact iCloud copy is returned, ahead of the generic fallback.
    expect(body).toContain(ICLOUD_COPY);
  });

  test("T-1348-02 trim / FFmpeg failure tokens route to the trim copy", () => {
    const body = mapperBody();
    const lower = body.toLowerCase();
    expect(lower).toContain("trimming_failed");
    expect(lower).toContain("command failed");
    expect(lower).toContain("video trim");
    expect(body).toContain(TRIM_COPY);
  });

  test("T-1348-03 the generic fallback copy is present (non-Error / unmatched)", () => {
    expect(picker).toContain(`return "${GENERIC_COPY}";`);
  });

  test("T-1348-04 a never-presented trim editor keeps its own friendly copy (pass-through)", () => {
    const body = mapperBody();
    expect(body).toContain("trim screen didn't open");
  });
});

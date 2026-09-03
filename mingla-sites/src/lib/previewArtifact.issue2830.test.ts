import { describe, expect, it } from "vitest";
import { parsePreviewArtifactKey } from "./previewArtifact";

const SITE = "11111111-2222-4333-8444-555555555555";
const NONCE = "a".repeat(32);
const DIGEST = "b".repeat(64);
const VALID = `publications/${SITE}/preview-${NONCE}/${DIGEST}.json`;

describe("#2830 preview artifact key is a capability, not a file path", () => {
  it("accepts the exact shape the CMS mints", () => {
    const parsed = parsePreviewArtifactKey(VALID);
    expect(parsed).not.toBeNull();
    expect(parsed?.siteId).toBe(SITE);
    expect(parsed?.publicationId).toBe(`preview-${NONCE}`);
    expect(parsed?.digest).toBe(DIGEST);
  });

  it("REFUSES a real publication -- the preview route is not a way to serve one", () => {
    expect(
      parsePreviewArtifactKey(
        `publications/${SITE}/${"c".repeat(32)}/${DIGEST}.json`,
      ),
    ).toBeNull();
    expect(
      parsePreviewArtifactKey(
        `publications/${SITE}/66666666-7777-4888-8999-aaaaaaaaaaaa/${DIGEST}.json`,
      ),
    ).toBeNull();
  });

  it("refuses traversal, other prefixes, and anything oversized", () => {
    const bad: (string | null | undefined)[] = [
      `publications/${SITE}/preview-${NONCE}/../../../secrets.json`,
      `../publications/${SITE}/preview-${NONCE}/${DIGEST}.json`,
      `media/${SITE}/preview-${NONCE}/${DIGEST}.json`,
      `publications/${SITE}/preview-${NONCE}/${DIGEST}.json/extra`,
      `publications/not-a-uuid/preview-${NONCE}/${DIGEST}.json`,
      `publications/${SITE}/preview-${NONCE}/${DIGEST}.JSON`,
      `publications/${SITE}/preview-${"a".repeat(31)}/${DIGEST}.json`,
      `${VALID}?x=1`,
      VALID + "a".repeat(300),
      "",
      null,
      undefined,
    ];
    for (const value of bad) {
      expect(parsePreviewArtifactKey(value)).toBeNull();
    }
  });

  it("refuses a key carrying a newline or a space", () => {
    expect(parsePreviewArtifactKey(VALID + String.fromCharCode(10))).toBeNull();
    expect(
      parsePreviewArtifactKey(
        `publications/${SITE}/preview-${NONCE}/ ${DIGEST}.json`,
      ),
    ).toBeNull();
  });
});

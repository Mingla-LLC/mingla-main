import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../../lib/crypto";

const { readPrivateObject } = vi.hoisted(() => ({
  readPrivateObject: vi.fn(),
}));

vi.mock("../../../../lib/storageReader", () => ({
  readPrivateObject,
}));

import {
  isFreshProbeTimestamp,
  verifyCandidateMedia,
} from "./route";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const SITE_ID = "00000000-0000-4000-8000-000000000001";
const MEDIA_ID = "00000000-0000-4000-8000-000000000002";

describe("#2893 candidate probe integrity", () => {
  it("rejects invalid, noncanonical, future, and stale timestamps", () => {
    expect(isFreshProbeTimestamp("2026-09-01T12:00:00.000Z", NOW)).toBe(true);
    for (const value of [
      "not-a-date",
      "2026-09-01T12:00:00Z",
      "2026-09-01T11:58:59.999Z",
      "2026-09-01T12:01:00.001Z",
    ]) expect(isFreshProbeTimestamp(value, NOW)).toBe(false);
  });

  it("fetches private approved media and rejects replaced bytes", async () => {
    const expected = new TextEncoder().encode("approved-image");
    const media = [{
      id: MEDIA_ID,
      url: `/media/${MEDIA_ID}/640`,
      alt: "Gogi dish",
      width: 640,
      height: 480,
      integrity: await sha256(expected),
      object_key:
        `approved/${SITE_ID}/${MEDIA_ID}/${"a".repeat(64)}/640.webp`,
    }];
    readPrivateObject.mockResolvedValueOnce(new Response(expected));
    await expect(
      verifyCandidateMedia(media, "sites-media-approved"),
    ).resolves.toBe(true);

    readPrivateObject.mockResolvedValueOnce(
      new Response(new TextEncoder().encode("replaced-image")),
    );
    await expect(
      verifyCandidateMedia(media, "sites-media-approved"),
    ).resolves.toBe(false);
    expect(readPrivateObject).toHaveBeenLastCalledWith(
      "sites-media-approved",
      media[0].object_key,
      "no-store",
    );
  });
});

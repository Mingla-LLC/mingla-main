/*
 * #4572 item 14 (D13) — a 1080 px photo (Instagram size) gets the phone-fine
 * hint; under 1080 px the old hint stays; both stay suggestions.
 * FAILS-ON-REVERT: without the PHONE_FINE_WIDTH branch the 1080 px message is
 * the old one.
 */
import { describe, expect, it } from "vitest";
import { PHONE_FINE_WIDTH, runDesignChecks } from "./designChecks";

function photosFor(width: number) {
  const checks = runDesignChecks({
    pages: [{ id: "p1", slug: "", title: "Home", enabled: true, blocks: [{ blockType: "hero", heading: "Kolanut", media: "m-1", ctas: [] }] }],
    settings: { design: "maison" },
    navigation: { items: [] },
    media: [{ id: "m-1", width, height: 1350, detected_mime: "image/jpeg" }],
    content: {},
    evidence: { offerings: [], brand_texts: ["Kolanut"] },
    owner_texts: [],
  } as never);
  return checks.find((check) => check.key === "photos")!;
}

describe("#4572 item 14 — sharpness hint", () => {
  it("1080 px says it looks fine on phones", () => {
    expect(PHONE_FINE_WIDTH).toBe(1080);
    const photos = photosFor(1080);
    expect(photos.items.map((item) => item.message).join("\n")).toContain("the picture is 1080 px wide. It looks fine on phones (Instagram photos are about this size); on large screens it looks sharpest from 1600 px.");
    expect(photos.status).toBe("warn");
  });

  it("1079 px keeps today's hint", () => {
    const message = photosFor(1079).items.map((item) => item.message).join("\n");
    expect(message).toContain("the picture is 1079 px wide; this spot looks sharp from 1600 px");
    expect(message).not.toContain("fine on phones");
  });
});

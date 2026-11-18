/*
 * #4453 final pass (tester P4-1, comment 6945336387) — the share view's
 * publication id is derived from the preview id with a one-way hash, so the
 * share view carries no run of the preview id's characters.
 */
import { describe, expect, it } from "vitest";
import { isPreviewPublication, isSharedPreviewPublication, showsDraftHints } from "./previewPublication";
import { sharedViewPublicationId } from "./sharedView";

const PREVIEW_HEX = "0123456789abcdef0123456789abcdef";
const PREVIEW_ID = `preview-${PREVIEW_HEX}`;

describe("#4453 share view id", () => {
  it("is a share id that is still a preview (nothing counted) and draws no Draft hints", () => {
    const shared = sharedViewPublicationId(PREVIEW_ID);
    expect(shared).toMatch(/^preview-shared-[0-9a-f]{32}$/);
    expect(isPreviewPublication(shared)).toBe(true);
    expect(isSharedPreviewPublication(shared)).toBe(true);
    expect(showsDraftHints(shared)).toBe(false);
  });

  it("shares no 8-character run with the preview id's hex", () => {
    const hex = sharedViewPublicationId(PREVIEW_ID).slice("preview-shared-".length);
    expect(hex).not.toBe(PREVIEW_HEX);
    for (let i = 0; i + 8 <= PREVIEW_HEX.length; i += 1) expect(hex).not.toContain(PREVIEW_HEX.slice(i, i + 8));
  });

  it("is stable for one preview, differs between previews, and keeps an id that is already a share id", () => {
    const a = sharedViewPublicationId(PREVIEW_ID);
    expect(sharedViewPublicationId(PREVIEW_ID)).toBe(a);
    expect(sharedViewPublicationId(`preview-${"f".repeat(32)}`)).not.toBe(a);
    expect(sharedViewPublicationId(a)).toBe(a);
  });
});

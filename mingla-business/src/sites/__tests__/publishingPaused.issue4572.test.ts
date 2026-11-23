/*
 * #4572 item 15 — Go live was refused with a bare INVALID_STATE while the
 * panel said "Checks: Ready". The Host now reads Core's one readiness owner
 * (brand_site_publishing_paused) and the server's refusal carries the same
 * sentence: "Publishing is paused for a few minutes" with Go live off, and a
 * PUBLISHING_PAUSED 503 becomes that sentence (retryable), never the generic
 * outage line or a bare reference.
 * FAILS-ON-REVERT: without the publishingPaused branch the gate says "Go live";
 * without the reason_code branch the 503 reads "temporarily unavailable".
 */
jest.mock("../../services/supabase", () => ({ supabase: { rpc: jest.fn(async () => ({ data: true, error: null })) } }));

import { brandSitesErrorFrom, getBrandSitePublishingPaused, PUBLISHING_PAUSED_MESSAGE, PUBLISHING_PAUSED_TITLE } from "../../services/brandSitesService";
import { publishGate } from "../workspaceStatus";
import { isSitePreviewKey, brandSiteKeys } from "../brandSiteKeys";

const base = { canPublish: true, live: false, unpublished: 3, unread: 0, unreadablePairs: 0, checking: false, blocker: null, checkFailed: false, publishing: false, lockedBy: false as const, offlineDevice: false };

describe("#4572 item 15 — publishing paused", () => {
  it("paused: no Go live, the pause sentence instead", () => {
    const gate = publishGate({ ...base, publishingPaused: true });
    expect(gate).toEqual({ label: PUBLISHING_PAUSED_TITLE, blocked: true, reason: PUBLISHING_PAUSED_MESSAGE, next: "wait" });
    expect(gate.label).not.toContain("Ready");
  });

  it("not paused (or a site already live) keeps today's gate", () => {
    expect(publishGate({ ...base, publishingPaused: false }).label).toBe("Go live");
    expect(publishGate({ ...base, live: true, publishingPaused: true }).label).toBe("Publish 3 changes");
  });

  it("the server's PUBLISHING_PAUSED 503 is the same sentence, retryable", () => {
    const error = brandSitesErrorFrom(503, { ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE", message: "x", retryable: true, reason_code: "PUBLISHING_PAUSED" } });
    expect(error.code).toBe("PUBLISHING_PAUSED");
    expect(error.message).toBe(PUBLISHING_PAUSED_MESSAGE);
    expect(error.retryable).toBe(true);
  });

  it("reads Core's paused state; a failed read is not paused", async () => {
    await expect(getBrandSitePublishingPaused("s1")).resolves.toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require("../../services/supabase");
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    await expect(getBrandSitePublishingPaused("s1")).resolves.toBe(false);
  });
});

describe("#4572 item 1 — the preview grant key", () => {
  it("matches every site's preview grant and nothing else", () => {
    expect(isSitePreviewKey(brandSiteKeys.siteData("s1", "preview"))).toBe(true);
    expect(isSitePreviewKey(brandSiteKeys.siteData(null, "preview"))).toBe(true);
    expect(isSitePreviewKey(brandSiteKeys.siteData("s1", "media"))).toBe(false);
  });
});

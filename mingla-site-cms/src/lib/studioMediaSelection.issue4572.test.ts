/*
 * #4572 item 16 — the Media page's "Choose where to use it" offers the site
 * logo and social image, and attaching writes only that settings field.
 * FAILS-ON-REVERT: without studioSettingsTargets there is no "Site settings ·
 * Logo" target, and without the site_settings body the client posts a page
 * block attach the server refuses.
 */
import { describe, expect, it, vi } from "vitest";
import { applyStudioSettingsSelection, studioSettingsTargets } from "./studioMediaSelection";
import { attachStudioMedia } from "./studioMediaClient";

const mediaA = "00000000-0000-4000-8000-000000000010";
const mediaB = "00000000-0000-4000-8000-000000000011";
const settings = { id: 42, updatedAt: "2026-11-23T10:00:00.000Z", logo: mediaA, social_image: null };

describe("#4572 item 16 — logo and social image targets", () => {
  it("lists Site settings · Logo and Social image with the current choice", () => {
    const targets = studioSettingsTargets(settings);
    expect(targets.map((target) => target.label)).toEqual(["Site settings · Logo", "Site settings · Social image"]);
    expect(targets[0]).toMatchObject({ scope: "site_settings", settingsField: "logo", pageId: "42", expectedRevision: settings.updatedAt, currentMediaId: mediaA, decorativeOnly: true });
    expect(targets[1]).toMatchObject({ settingsField: "social_image", currentMediaId: null });
    expect(studioSettingsTargets(null)).toEqual([]);
  });

  it("writes only the chosen field", () => {
    expect(applyStudioSettingsSelection(settings, mediaB, { expectedRevision: settings.updatedAt, field: "logo" })).toEqual({ logo: mediaB });
    expect(applyStudioSettingsSelection(settings, mediaB, { expectedRevision: settings.updatedAt, field: "social_image" })).toEqual({ social_image: mediaB });
  });

  it("refuses a stale revision, another field and a bad id", () => {
    expect(() => applyStudioSettingsSelection(settings, mediaB, { expectedRevision: "2026-11-22T00:00:00.000Z", field: "logo" })).toThrow("REVISION_CONFLICT");
    expect(() => applyStudioSettingsSelection(settings, mediaB, { expectedRevision: settings.updatedAt, field: "display_name" })).toThrow("VALIDATION_FAILED");
    expect(() => applyStudioSettingsSelection(settings, "not-an-id", { expectedRevision: settings.updatedAt, field: "logo" })).toThrow("REVISION_CONFLICT");
  });

  it("the client posts a site_settings attach and checks the Site settings return", async () => {
    const target = studioSettingsTargets(settings)[0]!;
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      data: { page_id: "42", media_id: mediaB, draft_revision: "x", state: 8, return_url: "/admin/collections/site-settings/42" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await attachStudioMedia(mediaB, target, { altText: "", decorative: true }, { request });
    expect(result.return_url).toBe("/admin/collections/site-settings/42");
    const body = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(body).toEqual({ scope: "site_settings", page_id: "42", expected_revision: settings.updatedAt, field: "logo" });
  });
});

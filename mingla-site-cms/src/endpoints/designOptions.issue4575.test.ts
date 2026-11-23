/*
 * #4575 — Grid's design options through the two look saves.
 *
 * `propose_site_settings_update` (the Business app's look save through Core)
 * and the workspace `set_look` both accept `design_options` from the owner
 * and refuse an invalid value; Ari can never set them. A save that does not
 * send them (an older Business app, SC-11) leaves the stored choice intact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gateway")>()),
  verifyCoreRequest: vi.fn(async () => ({ site_id: "44530000-0000-4000-8000-00000000c001" })),
  callCore: vi.fn(async () => { throw new Error("these saves never ask Core for anything"); }),
}));
vi.mock("../lib/config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("../lib/objectStore", () => ({ presignedGet: vi.fn(async () => "https://thumbs.test/x"), readObject: vi.fn(), writeObject: vi.fn() }));
vi.mock("../lib/lookSavedReport", () => ({ reportLookSavedHook: () => async () => undefined }));
vi.mock("../lib/observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));

import { sitesEndpoints } from "./sitesEndpoints";
import { contentEndpoints } from "./contentEndpoint";
import { setLook } from "../lib/sectionActions";
import { AriRefusal } from "../lib/ariSiteActions";
import { BRAND, SITE, TENANT, USER, memberRequest, seedSite, signedRequest, type Doc } from "./workspaceTestKit.issue4453";

type Site = Awaited<ReturnType<typeof seedSite>>;

const ariEndpoint = sitesEndpoints.find((endpoint) => endpoint.path === "/internal/ari")!;

async function ari(site: Site, action: string, args: Doc = {}) {
  const response = await ariEndpoint.handler(signedRequest(site, { action, site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args }));
  const json = await response.json() as Doc;
  return { status: response.status, data: (json.data ?? {}) as Doc, error: (json.error ?? {}) as Doc };
}

async function content(site: Site, action: string, args: Doc = {}) {
  const response = await contentEndpoints[0]!.handler(signedRequest(site, { action, site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args }));
  const json = await response.json() as Doc;
  return { status: response.status, data: (json.data ?? {}) as Doc, error: (json.error ?? {}) as Doc };
}

const stored = (site: Site) => site.rows("site-settings")[0]!;
const revision = (site: Site) => String(stored(site).updatedAt);
const propose = (site: Site, changes: Doc) => ari(site, "propose_site_settings_update", { expected_revision: revision(site), changes });

let site: Site;
beforeEach(async () => {
  site = await seedSite("grid");
});

describe("#4575 propose_site_settings_update (the Business app's look save)", () => {
  it("saves design_options and changes nothing else", async () => {
    const before = structuredClone(stored(site));
    const saved = await propose(site, { design_options: { cover: "full", photos: null } });
    expect(saved.status).toBe(200);
    expect(stored(site).design_options).toEqual({ cover: "full", photos: null });
    for (const key of ["design", "tokens", "fonts", "radius", "button_shape", "motion"]) expect(stored(site)[key], key).toEqual(before[key]);
  });

  it("refuses an invalid value and stores nothing", async () => {
    const current = revision(site);
    for (const bad of [{ cover: "half" }, { photos: "sepia" }, { ticker: "on" }, "full", ["cover"]]) {
      const refused = await propose(site, { design_options: bad });
      expect(refused.error.code, JSON.stringify(bad)).toBe("VALIDATION_FAILED");
    }
    expect(revision(site)).toBe(current);
    expect(stored(site).design_options).toBeUndefined();
  });

  it("an older app's save of tokens and fonts keeps the stored options (SC-11)", async () => {
    await propose(site, { design_options: { cover: "full", photos: "mono" } });
    const saved = await propose(site, { tokens: { colors: { canvas: "#fffaf0" } }, fonts: {} });
    expect(saved.status).toBe(200);
    expect(stored(site).design_options).toEqual({ cover: "full", photos: "mono" });
    expect(stored(site).tokens).toEqual({ colors: { canvas: "#fffaf0" } });
  });
});

describe("#4575 set_look (the website workspace)", () => {
  it("the owner saves design_options; a later set_look without them keeps them (SC-11)", async () => {
    const saved = await content(site, "set_look", { expected_revision: revision(site), design_options: { cover: "full", photos: null } });
    expect(saved.status).toBe(200);
    expect(stored(site).design_options).toEqual({ cover: "full", photos: null });
    expect((await content(site, "set_look", { expected_revision: revision(site), radius: "soft" })).status).toBe(200);
    expect(stored(site)).toMatchObject({ radius: "soft", design_options: { cover: "full", photos: null } });
  });

  it("Undo restores the previous options", async () => {
    await content(site, "set_look", { expected_revision: revision(site), design_options: { cover: "full", photos: null } });
    await content(site, "set_look", { expected_revision: revision(site), design_options: { cover: null, photos: "colour" } });
    expect(stored(site).design_options).toEqual({ cover: null, photos: "colour" });
    expect((await content(site, "undo")).status).toBe(200);
    expect(stored(site).design_options).toEqual({ cover: "full", photos: null });
  });

  it("refuses an invalid value", async () => {
    const current = revision(site);
    for (const bad of [{ cover: "half" }, { photos: 3 }, { extra: "x" }, "full"]) {
      expect((await content(site, "set_look", { expected_revision: current, design_options: bad })).error.code, JSON.stringify(bad)).toBe("VALIDATION_FAILED");
    }
    expect(revision(site)).toBe(current);
  });

  it("Ari is refused: design options are the owner's choice", async () => {
    const req = memberRequest(site);
    const ctx = { req, scoped: req, tenantId: TENANT, userId: USER, actor: "ari" as const, group: { groupId: null, groupLabel: null } };
    const current = revision(site);
    let refusal: unknown = null;
    try {
      await setLook(ctx, { design_options: { cover: "full" } });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(AriRefusal);
    expect(refusal).toMatchObject({ message: "VALIDATION_FAILED", extra: { problems: ["Design options are the owner's choice"] } });
    expect(revision(site)).toBe(current);
    // Ari's own step cannot name the field either (STEP_KEYS unchanged).
    const step = await ari(site, "apply_site_change", { group_id: "44530000-0000-4000-8000-0000000f0001", group_label: "x", why: "x", cites: [], step: { op: "set_look", design_options: { cover: "full" } } });
    expect(step.error.code).toBe("VALIDATION_FAILED");
    expect(stored(site).design_options).toBeUndefined();
  });
});

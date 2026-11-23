/**
 * #4572 items 17 and 16 — Ari's workspace shows the header button and the
 * logo, and has a step for each that changes ONLY that thing:
 *   - set_header_button changes navigation.header_cta, never a menu item
 *     (Kolanut: "change the red button's words from Tckets to RSVP" renamed
 *     the Events menu item instead);
 *   - set_menu never touches the header button;
 *   - set_logo changes only site_settings.logo, to one of the site's READY photos;
 *   - each is undone on its own by undo_site_change_group.
 * Plus item 8: Add section lists Cover only where the server accepts it.
 * FAILS-ON-REVERT: without set_header_button / set_logo in STEP_OPS the steps
 * are refused (VALIDATION_FAILED "step.op must be one of …"), and without
 * header_button / logo in the snapshot Ari cannot see either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gateway")>()),
  verifyCoreRequest: vi.fn(async () => ({ site_id: "44530000-0000-4000-8000-00000000c001" })),
  callCore: vi.fn(async () => { throw new Error("the workspace never asks Core for anything"); }),
}));
vi.mock("../lib/config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("../lib/objectStore", () => ({ presignedGet: vi.fn(async () => "https://thumbs.test/x"), readObject: vi.fn(), writeObject: vi.fn() }));
vi.mock("../lib/lookSavedReport", () => ({ reportLookSavedHook: () => async () => undefined }));
vi.mock("../lib/observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));

import { sitesEndpoints } from "./sitesEndpoints";
import { contentEndpoints } from "./contentEndpoint";
import { BRAND, PHOTO_B, PHOTO_PROCESSING, SITE, USER, seedSite, signedRequest, type Doc } from "./workspaceTestKit.issue4453";

type Site = Awaited<ReturnType<typeof seedSite>>;
const ariEndpoint = sitesEndpoints.find((endpoint) => endpoint.path === "/internal/ari")!;
const EVIDENCE = {
  booking_identity: 1,
  brand: { id: BRAND, name: "Kolanut Gallery", description: "A gallery in Abuja.", city: "Abuja", slug: "kolanut", contact_email: null, contact_phone: null, social_handles: [] },
  offerings: [],
};
// The owner's exact sentence (agent_messages, 2026-11-23 18:23:55).
const KOLANUT = "change the red button's words from Tckets to RSVP, still linking to the events page";
const CITES = [{ kind: "owner_words", quote: KOLANUT }];
const GROUP = "45720000-0000-4000-8000-0000000f0017";

async function ari(site: Site, action: string, args: Doc = {}) {
  const response = await ariEndpoint.handler(signedRequest(site, { action, site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args, evidence: EVIDENCE }));
  const json = await response.json() as Doc;
  return { status: response.status, data: (json.data ?? {}) as Doc, error: (json.error ?? {}) as Doc };
}
const apply = (site: Site, step: Doc, extra: Doc = {}) =>
  ari(site, "apply_site_change", { group_id: GROUP, group_label: "Change the header button", why: "The owner asked for it.", cites: CITES, step, ...extra });
const nav = (site: Site) => site.rows("navigation")[0]!;
const menuOf = (site: Site) => (nav(site).items as Doc[]).map(({ id: _id, ...item }) => item);

let site: Site;
beforeEach(async () => {
  site = await seedSite();
  // Kolanut's header: a red "Tickets" button and an Events-like menu item, both to the About page here.
  nav(site).header_cta = { label: "Tickets", target_type: "page", page: site.aboutId };
});

describe("#4572 item 17 — the header button is its own step", () => {
  it("the snapshot shows the header button and the logo", async () => {
    const { data } = await ari(site, "get_site_workspace");
    expect(data.header_button).toEqual({ label: "Tickets", page_id: site.aboutId, links_outside: false });
    expect(data.logo).toEqual({ media_id: null });
    // The menu is the page links only.
    expect(data.menu).toEqual([{ page_id: site.aboutId, label: "About" }]);
  });

  it("set_header_button relabels the button and leaves every menu item byte-identical", async () => {
    const before = JSON.stringify(nav(site).items);
    const done = await apply(site, { op: "set_header_button", button_label: "RSVP" });
    expect(done.status, JSON.stringify(done.error)).toBe(200);
    expect(nav(site).header_cta).toMatchObject({ label: "RSVP", target_type: "page", page: site.aboutId });
    expect(JSON.stringify(nav(site).items)).toBe(before);
  });

  it("set_header_button can point the button at another page", async () => {
    const done = await apply(site, { op: "set_header_button", button_label: "Visit", page_id: site.homeId });
    expect(done.status, JSON.stringify(done.error)).toBe(200);
    expect(nav(site).header_cta).toMatchObject({ label: "Visit", page: site.homeId });
  });

  it("set_menu never touches the header button", async () => {
    const done = await apply(site, { op: "set_menu", items: [{ page_id: site.aboutId, label: "RSVP" }] });
    expect(done.status, JSON.stringify(done.error)).toBe(200);
    expect(nav(site).header_cta).toMatchObject({ label: "Tickets", page: site.aboutId });
    expect(menuOf(site)[0]).toMatchObject({ label: "RSVP" });
  });

  it("refuses a bad page, an over-long or marked-up label, and a missing citation", async () => {
    expect((await apply(site, { op: "set_header_button", button_label: "RSVP", page_id: "not-a-page" })).error.code).toBe("PAGE_NOT_FOUND");
    expect((await apply(site, { op: "set_header_button", button_label: "R".repeat(200) })).error.code).toBe("VALIDATION_FAILED");
    expect((await apply(site, { op: "set_header_button", button_label: "<b>RSVP</b>" })).error.code).toBe("VALIDATION_FAILED");
    expect((await apply(site, { op: "set_header_button", button_label: "RSVP" }, { cites: [] })).error.code).toBe("CITATION_REQUIRED");
    expect(nav(site).header_cta).toMatchObject({ label: "Tickets" });
  });

  it("undo puts the button back and leaves the menu as it is", async () => {
    await apply(site, { op: "set_header_button", button_label: "RSVP" });
    const menu = menuOf(site);
    const undone = await ari(site, "undo_site_change_group", { group_id: GROUP });
    expect(undone.status, JSON.stringify(undone.error)).toBe(200);
    expect(nav(site).header_cta).toMatchObject({ label: "Tickets", page: site.aboutId });
    expect(menuOf(site)).toEqual(menu);
  });
});

describe("#4572 item 16 — set_logo", () => {
  it("sets the logo to a READY photo, removes it with null, and undoes on its own", async () => {
    const set = await apply(site, { op: "set_logo", media_id: PHOTO_B }, { cites: [] });
    expect(set.status, JSON.stringify(set.error)).toBe(200);
    expect(site.rows("site-settings")[0]!.logo).toBe(PHOTO_B);
    const tokens = structuredClone(site.rows("site-settings")[0]!.tokens ?? null);
    const undone = await ari(site, "undo_site_change_group", { group_id: GROUP });
    expect(undone.status, JSON.stringify(undone.error)).toBe(200);
    expect(site.rows("site-settings")[0]!.logo ?? null).toBeNull();
    expect(site.rows("site-settings")[0]!.tokens ?? null).toEqual(tokens);
  });

  it("refuses a photo that is not ready", async () => {
    const refused = await apply(site, { op: "set_logo", media_id: PHOTO_PROCESSING }, { cites: [] });
    expect(refused.status).not.toBe(200);
    expect(site.rows("site-settings")[0]!.logo ?? null).toBeNull();
  });
});

describe("#4572 item 8 — Add section offers Cover only where the server takes it", () => {
  const catalog = async (pageId: string) => {
    const response = await contentEndpoints[0]!.handler(signedRequest(site, { action: "section_catalog", site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args: { page_id: pageId } }));
    return ((await response.json()) as Doc).data as { types: Doc[]; cover_note: string | null };
  };

  it("not on another page, with the one-line reason", async () => {
    const about = await catalog(site.aboutId);
    expect(about.types.map((entry) => entry.type)).not.toContain("hero");
    expect(about.cover_note).toBe("A cover can only go at the top of Home.");
  });

  it("not on a Home that already has a cover", async () => {
    const home = await catalog(site.homeId);
    expect(home.types.map((entry) => entry.type)).not.toContain("hero");
    expect(home.cover_note).toBe("Home already has a cover. Change it in Design → Cover.");
  });

  it("first in the list on a Home with only a colour panel", async () => {
    const home = site.rows("pages").find((page) => String(page.id) === site.homeId)!;
    home.blocks = (home.blocks as Doc[]).filter((block) => block.blockType !== "hero");
    const listed = await catalog(site.homeId);
    expect(listed.types[0]).toMatchObject({ type: "hero", label: "Cover", needs_photo: true });
    expect(listed.cover_note).toBeNull();
  });

  it("Ari's addable list drops Cover while Home has one", async () => {
    const { data } = await ari(site, "get_site_workspace");
    expect((data.addable_sections as Doc[]).map((entry) => entry.type)).not.toContain("hero");
  });
});

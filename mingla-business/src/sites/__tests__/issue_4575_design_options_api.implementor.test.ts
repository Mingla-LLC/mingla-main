/*
 * #4575 — Grid's design options on the wire.
 *
 * The look read carries `designOptions` (invalid stored values read as
 * none); both saves send `design_options` ONLY when the owner changed them,
 * with every option explicit (a cleared one as null, so the stored choice is
 * cleared too), and never touch the colours they were given.
 */
const mockInvoke = jest.fn();
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) }));

import { getBrandSiteLook, saveBrandSiteLook } from "../../services/brandSitesService";
import { setSiteLook } from "../contentApi";
import { designOptionsPayload, safeDesignOptions } from "../siteLook";

type Body = { route: string; action: string; args: Record<string, unknown> };
const lastBody = (): Body => (mockInvoke.mock.calls.at(-1)![1] as { body: Body }).body;

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("#4575 safeDesignOptions / designOptionsPayload", () => {
  it("keeps only valid set values", () => {
    expect(safeDesignOptions({ cover: "full", photos: null })).toEqual({ cover: "full" });
    expect(safeDesignOptions({ cover: null, photos: "mono" })).toEqual({ photos: "mono" });
    expect(safeDesignOptions(null)).toEqual({});
    expect(safeDesignOptions(undefined)).toEqual({});
    expect(safeDesignOptions({ cover: "half" })).toEqual({});
    expect(safeDesignOptions("full")).toEqual({});
  });

  it("sends every option explicitly", () => {
    expect(designOptionsPayload({ cover: "full" })).toEqual({ cover: "full", photos: null });
    expect(designOptionsPayload({})).toEqual({ cover: null, photos: null });
  });
});

describe("#4575 the look read and the Website design save (propose_site_settings_update)", () => {
  it("reads the stored options", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, data: { settings: { design: "grid", tokens: {}, fonts: {}, design_options: { cover: "full", photos: null }, updatedAt: "r1" } } }, error: null });
    expect(await getBrandSiteLook({ brandId: "b", siteId: "s" })).toEqual({ design: "grid", tokens: {}, fonts: {}, designOptions: { cover: "full" }, revision: "r1" });
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, data: { settings: { design: "grid", tokens: {}, fonts: {}, updatedAt: "r1" } } }, error: null });
    expect((await getBrandSiteLook({ brandId: "b", siteId: "s" })).designOptions).toEqual({});
  });

  it("sends design_options only when given, and the tokens exactly as given", async () => {
    const tokens = { colors: { canvas: "#f1efe9", accent: "#c0392b" } };
    mockInvoke.mockResolvedValue({ data: { ok: true, data: { revision: "r2" } }, error: null });
    await saveBrandSiteLook({ brandId: "b", siteId: "s", revision: "r1", tokens, fonts: {} });
    expect(lastBody().args.changes).toEqual({ tokens, fonts: {} });
    expect(lastBody().args.changes).not.toHaveProperty("design_options");
    await saveBrandSiteLook({ brandId: "b", siteId: "s", revision: "r1", tokens, fonts: {}, designOptions: { cover: "full" } });
    expect(lastBody()).toMatchObject({ action: "propose_site_settings_update" });
    expect(lastBody().args.changes).toEqual({ tokens, fonts: {}, design_options: { cover: "full", photos: null } });
    await saveBrandSiteLook({ brandId: "b", siteId: "s", revision: "r1", tokens, fonts: {}, designOptions: {} });
    expect(lastBody().args.changes).toEqual({ tokens, fonts: {}, design_options: { cover: null, photos: null } });
  });
});

describe("#4575 the workspace save (set_look)", () => {
  it("sends design_options only when given", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, data: { look_revision: "r2", warnings: [] } }, error: null });
    await setSiteLook("s", { expectedRevision: "r1", radius: "soft" });
    expect(lastBody()).toMatchObject({ action: "set_look" });
    expect(lastBody().args).not.toHaveProperty("design_options");
    await setSiteLook("s", { expectedRevision: "r1", designOptions: { photos: "colour" } });
    expect(lastBody().args).toEqual({ expected_revision: "r1", design_options: { cover: null, photos: "colour" } });
  });
});

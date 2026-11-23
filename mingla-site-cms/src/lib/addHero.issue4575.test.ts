/*
 * #4575 (cover gap) — an owner can add the cover ("Big picture") from Add
 * section. It goes first, replaces a page title (keeping the owner's words),
 * is refused a second time, starts with no button row, and is never offered
 * to Ari.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
let pages: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("./tenantPages", () => ({ findAllTenantPages: async () => pages }));
vi.mock("./ariSiteActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ariSiteActions")>()),
  currentSettings: async () => ({ design: "grid" }),
  readyMedia: async () => new Map(),
}));
vi.mock("./draftHistory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./draftHistory")>()),
  recordChanges: async (_ctx: unknown, _actor: unknown, changes: Array<Record<string, any>>) => { rows.push(...changes); return "group"; }, // eslint-disable-line @typescript-eslint/no-explicit-any
}));

import { addSection, sectionCatalog, ADDABLE_SECTION_TYPES, type SectionContext } from "./sectionActions";

const MEDIA = "22222222-2222-4222-8222-222222222222";

function ctx(actor: "user" | "ari" = "user"): SectionContext {
  const payload = { update: async ({ data }: { data: Record<string, unknown> }) => ({ ...pages[0], ...data }) };
  const scoped = { context: {} };
  return { actor, group: { groupId: null, groupLabel: null }, req: { payload } as never, scoped: scoped as never, tenantId: "t1", userId: "u1" };
}

const refusal = async (run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { return error as Error & { extra?: Record<string, unknown> }; }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  rows.length = 0;
  pages = [{
    id: "p1", slug: "", title: "Home", revision: "r1",
    blocks: [
      { id: "ph", blockType: "page_header", heading: "Modern art", subheading: "Line A\n Line B \n", media_url: "https://x.example/a.jpg" },
      { id: "rt", blockType: "rich_text", heading: "Hello" },
    ],
  }];
});

describe("#4575 the Big picture in Add section (SC-4)", () => {
  it("is offered first to owners on every design, needing a photo", () => {
    for (const design of ["grid", "atelier", "voyage"] as const) {
      const catalog = sectionCatalog(design, "user");
      expect(catalog[0]).toMatchObject({ type: "hero", label: "Big picture", needs_photo: true });
    }
    expect(ADDABLE_SECTION_TYPES[0]).toBe("hero");
  });

  it("is never offered to Ari", () => {
    expect(sectionCatalog("grid", "ari").map((entry) => entry.type)).not.toContain("hero");
  });

  it("replaces a page title: index 0, its heading, its lines joined, the chosen photo, no buttons", async () => {
    await addSection(ctx(), { page_id: "p1", type: "hero", media_id: MEDIA, after_section_id: "rt" });
    const saved = rows[0]!;
    const blocks = saved.after.blocks as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ blockType: "hero", heading: "Modern art", subheading: "Line A · Line B", media: MEDIA, ctas: [] });
    expect(blocks.some((block) => block.blockType === "page_header")).toBe(false);
    expect(blocks[1]!.id).toBe("rt");
    expect(saved.label).toBe("Add Big picture");
  });

  it("is one undoable change: the saved before-snapshot still has the page title", async () => {
    await addSection(ctx(), { page_id: "p1", type: "hero", media_id: MEDIA });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.before.blocks as Array<Record<string, unknown>>)[0]).toMatchObject({ blockType: "page_header", heading: "Modern art" });
  });

  it("with no page title it goes to the top and ignores after_section_id", async () => {
    pages[0]!.blocks = [{ id: "rt", blockType: "rich_text", heading: "Hello" }];
    await addSection(ctx(), { page_id: "p1", type: "hero", media_id: MEDIA, after_section_id: "rt" });
    const blocks = rows[0]!.after.blocks as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(blocks.map((block) => block.blockType)).toEqual(["hero", "rich_text"]);
    expect(blocks[0]!.ctas).toEqual([]);
  });

  it("cuts the joined lines at 300 characters", async () => {
    pages[0]!.blocks[0].subheading = `${"a".repeat(200)}\n${"b".repeat(200)}`;
    await addSection(ctx(), { page_id: "p1", type: "hero", media_id: MEDIA });
    expect(((rows[0]!.after.blocks as Array<Record<string, string>>)[0]!.subheading).length).toBe(300);
  });

  it("refuses a second big picture", async () => {
    pages[0]!.blocks = [{ id: "h", blockType: "hero", heading: "Hi", media: MEDIA, ctas: [] }];
    const error = await refusal(() => addSection(ctx(), { page_id: "p1", type: "hero", media_id: MEDIA }));
    expect(error.message).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(error.extra)).toContain("This page already has a big picture.");
    expect(rows).toHaveLength(0);
  });

  it("needs a photo", async () => {
    const error = await refusal(() => addSection(ctx(), { page_id: "p1", type: "hero" }));
    expect(error.message).toBe("MEDIA_REQUIRED");
  });

  it("Ari adding a hero is refused as not available", async () => {
    const error = await refusal(() => addSection(ctx("ari"), { page_id: "p1", type: "hero", media_id: MEDIA }));
    expect(error.message).toBe("SECTION_TYPE_NOT_AVAILABLE");
  });
});

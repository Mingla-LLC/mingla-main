import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * #2830 -- Mingla stays the authority for the menu.
 *
 * The Sites renderer only ever had `menu_link`: a button pointing at a PDF, so
 * a restaurant's actual menu could not appear on its own website. gogi's is 48
 * items and Mingla already owns them.
 *
 * The failure this guards against is a website that keeps its OWN copy of what
 * a restaurant sells. If a brand could type items into Payload, the site and
 * the app would drift, and a customer would read one price on the website and
 * pay another in the app.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

const blocks = read("src/blocks/restaurantBlocks.ts");
const builder = read("src/lib/artifactBuilder.ts");
const gateway = read("src/lib/gateway.ts");
const migration = read(
  "../supabase/migrations/20270617002830_issue_2830_brand_site_menu_projection.sql",
);
const callback = read("../supabase/functions/brand-site-cms-callback/index.ts");

describe("#2830 the menu belongs to Mingla", () => {
  it("the Payload block carries presentation ONLY -- no items, no prices", () => {
    const block = blocks.slice(blocks.indexOf('slug: "menu_board"'));
    const end = block.indexOf("slug: \"gallery\"");
    const menuBlock = block.slice(0, end);
    expect(menuBlock).toContain('short("heading"');
    expect(menuBlock).toContain('name: "note"');
    /*
     * Match FIELD DEFINITIONS, not the word. The block's own help text says
     * "Items and prices come from your Mingla menu", and a substring check on
     * "price" flagged that sentence -- the same match-the-comment trap the
     * #2830 leak guard has. What must not exist is a field a brand can type
     * into, so assert on the field-name form.
     */
    const fieldNames = [...menuBlock.matchAll(/name:\s*"([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    const arrayFields = [...menuBlock.matchAll(/type:\s*"(array|group)"/g)];
    expect(fieldNames.sort()).toEqual(["note"]);
    expect(arrayFields).toHaveLength(0);
    for (const forbidden of ["price", "items", "currency"]) {
      expect(fieldNames).not.toContain(forbidden);
    }
  });

  it("items are projected from Mingla at publish time", () => {
    expect(builder).toContain('block.blockType === "menu_board"');
    expect(builder).toContain("menuSections");
    expect(builder).toContain("readCoreProjection");
  });

  it("the menu is read ONLY when a page actually shows one", () => {
    expect(builder).toContain("wantsMenu");
    expect(gateway).toContain('if (includeMenu) query.set("include", "menu")');
    expect(callback).toContain('searchParams.get("include") === "menu"');
  });

  it("a price is never defaulted, in SQL or in the builder", () => {
    expect(builder).toContain(
      'price_minor: typeof row.price_cents === "number" ? row.price_cents : null',
    );
    expect(builder).toContain(
      'currency: typeof row.currency === "string" ? row.currency : null',
    );
    expect(migration).not.toMatch(/COALESCE\s*\(\s*mi\.price_cents/i);
    expect(migration).not.toMatch(/COALESCE\s*\(\s*mi\.currency/i);
  });

  it("Mingla's own ordering survives to the website", () => {
    expect(migration).toContain(
      "ORDER BY m.sort_order, m.name, mi.sort_order, mi.name",
    );
  });

  it("only active menus and available items reach a published site", () => {
    expect(migration).toContain("m.is_active = true");
    expect(migration).toContain("mi.is_available = true");
  });

  it("the projection is service-role only, never anon", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.brand_site_menu_projection(uuid)",
    );
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path TO 'public', 'pg_temp'");
  });

  it("an unknown site raises rather than publishing an empty menu", () => {
    expect(migration).toContain("INTO STRICT v_brand_id");
  });

  it("an empty menu drops the block instead of publishing a bare heading", () => {
    expect(builder).toContain("if (!menuSections.length) return null;");
  });
});

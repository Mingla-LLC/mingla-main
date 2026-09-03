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
    /*
     * Scoped to the PROJECTION, which is what feeds the website. The
     * fingerprint function further down deliberately coalesces a NULL price to
     * the literal 'null' so the digest is stable -- that is a hash input, not a
     * price anyone reads, and a file-wide ban flagged it. The rule is "the menu
     * the website renders never carries a defaulted price", so assert it where
     * that menu is built.
     */
    const projection = migration.slice(
      migration.indexOf("FUNCTION public.brand_site_menu_projection"),
      migration.indexOf("FUNCTION public.brand_site_orderable_venue"),
    );
    expect(projection.length).toBeGreaterThan(200);
    expect(projection).not.toMatch(/COALESCE\s*\(\s*mi\.price_cents/i);
    expect(projection).not.toMatch(/COALESCE\s*\(\s*mi\.currency/i);
    expect(projection).toContain("mi.price_cents,");
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

  it("no Mingla menu means no Menu TAB, not an empty page", () => {
    // The block drops when there are no items, and a non-home page whose
    // blocks all dropped disables itself -- so the tab leaves the navigation
    // and the sitemap with it.
    expect(builder).toContain("if (!menuSections.length) return null;");
    expect(builder).toContain(
      'page.role === "home"\n        ? page.enabled\n        : page.enabled === true && rendered.length > 0',
    );
  });

  it("the home page is never auto-removed", () => {
    expect(builder).toContain('page.role === "home"');
  });

  it("ordering resolves ONE verified venue, and never guesses", () => {
    expect(migration).toContain("brand_site_orderable_venue");
    expect(migration).toContain("claim_status = 'verified'");
    expect(migration).toContain("IF v_count = 1 THEN");
    expect(migration).toContain("RETURN NULL;");
  });

  it("the venue reaches the artifact so the cart knows where to send an order", () => {
    expect(builder).toContain("venue_id: menuVenueId");
    expect(callback).toContain("brand_site_orderable_venue");
  });

  it("each item carries its Mingla id, which is what the cart orders by", () => {
    expect(builder).toContain("id: String(row.item_id)");
  });
});

/*
 * #4572 item 16 — Studio's media pickers (the site logo, the social image,
 * every page-block photo and video) ask Payload for "this site's READY media".
 * Payload refuses a query on a field the user may not read ("The following
 * path cannot be queried: state", a 400 in Studio). This runs Payload's own
 * query check with a Studio member's request against every picker's
 * filterOptions, so a picker can never again query a field Studio can't read.
 * FAILS-ON-REVERT: with `state` / `detected_mime` read back to system-only,
 * validateQueryPaths throws QueryError for every picker below.
 */
import { describe, expect, it } from "vitest";
import { flattenAllFields, validateQueryPaths, type Field } from "payload";
import { Media } from "./Media";
import { SiteSettings } from "./SiteSettings";
import { SITE_CONTENT_COLLECTIONS } from "./SiteContent";
import { Pages } from "./Pages";
import { siteBlocks } from "../blocks/siteBlocks";

type AnyField = Field & { name?: string; type: string; relationTo?: unknown; filterOptions?: unknown; fields?: Field[]; blocks?: Array<{ slug: string; fields: Field[] }>; tabs?: Array<{ fields: Field[] }> };
type Picker = { where: string; filter: (args: { req: unknown }) => unknown };

/** Every relationship to media that filters what the picker lists. */
function pickers(fields: readonly Field[], where: string, out: Picker[] = []): Picker[] {
  for (const raw of fields) {
    const field = raw as AnyField;
    const here = field.name ? `${where}.${field.name}` : where;
    if ((field.type === "relationship" || field.type === "upload") && field.relationTo === "media" && typeof field.filterOptions === "function") {
      out.push({ where: here, filter: field.filterOptions as Picker["filter"] });
    }
    if (field.fields) pickers(field.fields, here, out);
    for (const block of field.blocks ?? []) pickers(block.fields, `${here}[${block.slug}]`, out);
    for (const tab of field.tabs ?? []) pickers(tab.fields, here, out);
  }
  return out;
}

const tenantId = "11111111-1111-4111-8111-111111111111";
const studioUser = { id: "u1", tenantId, siteId: "s1", rank: 30, collection: "studio-users" };
const mediaFields: Field[] = [...(Media.fields as Field[]), { name: "tenant", type: "text" } as Field];
const mediaConfig = { ...Media, fields: mediaFields, flattenedFields: flattenAllFields({ fields: mediaFields }) };

function studioRequest(context: Record<string, unknown> = {}) {
  return {
    user: studioUser,
    context,
    locale: undefined,
    payload: { collections: { media: { config: mediaConfig } }, config: { localization: false } },
  };
}

async function check(where: unknown, req = studioRequest()) {
  await validateQueryPaths({ collectionConfig: mediaConfig as never, overrideAccess: false, req: req as never, where: where as never });
}

const all: Picker[] = [
  ...pickers(SiteSettings.fields as Field[], "site-settings"),
  ...SITE_CONTENT_COLLECTIONS.flatMap((collection) => pickers(collection.fields as Field[], collection.slug)),
  ...pickers(Pages.fields as Field[], "pages"),
  ...siteBlocks.flatMap((block) => pickers(block.fields as Field[], `block[${block.slug}]`)),
];

describe("#4572 item 16 — Studio media pickers can run their own query", () => {
  it("finds the site logo and social image pickers", () => {
    const names = all.map((picker) => picker.where);
    expect(names).toContain("site-settings.logo");
    expect(names).toContain("site-settings.social_image");
    expect(all.length).toBeGreaterThanOrEqual(6);
  });

  it("every picker's filter is a query a Studio member may run (no 'cannot be queried')", async () => {
    const failures: string[] = [];
    for (const picker of all) {
      const where = picker.filter({ req: studioRequest() });
      expect(where, `${picker.where} returns a filter for a member`).toBeTruthy();
      try {
        await check(where);
      } catch (error) {
        failures.push(`${picker.where}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("the picker still lists only this site's READY media", () => {
    const logo = all.find((picker) => picker.where === "site-settings.logo")!;
    expect(logo.filter({ req: studioRequest() })).toEqual({ tenant: { equals: tenantId }, state: { equals: "READY" } });
    // No member, no list: the picker shows nothing rather than every tenant's media.
    expect(logo.filter({ req: { user: null, context: {} } })).toBe(false);
  });

  it("a field Studio still may not read stays unqueryable (the check is real)", async () => {
    await expect(check({ quarantine_key: { equals: "x" } })).rejects.toThrow(/cannot be queried/);
    await expect(check({ checksum: { equals: "x" } })).rejects.toThrow(/cannot be queried/);
  });
});

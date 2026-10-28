/*
 * #2829 W6 pre-item (b) — Studio writes without a tenant are bound to the
 * session's tenant, never stored invisibly.
 *
 * A Studio REST create that did not carry Studio's tenant selector stored a
 * page (or navigation, footer, settings) with no tenant: no one could see,
 * edit or publish it. Every tenant-scoped content collection now binds the
 * write to the session's tenant (or the tenant a signed Core call names) and
 * refuses another tenant or a move between sites.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CollectionBeforeChangeHook, CollectionConfig } from "payload";

vi.mock("./config", () => ({ cmsConfig: () => ({}) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));

import { bindRequestTenant } from "./tenantIntegrity";
import { NON_CONTENT_TENANT_COLLECTIONS, TENANT_MEDIA_HOLDERS } from "./mediaHolders";
import { Pages } from "../collections/Pages";

const TENANT = "00000000-0000-4000-8000-000000000c01";
const OTHER = "00000000-0000-4000-8000-000000000c09";
const studio = { id: "u1", tenantId: TENANT, siteId: "s", brandId: "b", rank: 60 };

type Doc = Record<string, unknown>;
const run = async (hook: CollectionBeforeChangeHook, args: Doc): Promise<Doc> =>
  (await hook({ collection: {}, context: {}, ...args } as never)) as Doc;

describe("#2829 bindRequestTenant", () => {
  it("binds a create with no tenant to the session's tenant", async () => {
    const out = await run(bindRequestTenant, { data: { title: "Orphan?" }, operation: "create", req: { user: studio, context: {} } });
    expect(out.tenant).toBe(TENANT);
  });

  it("binds a signed Core create to the tenant Core named", async () => {
    const out = await run(bindRequestTenant, {
      data: {},
      operation: "create",
      req: { user: null, context: { minglaSignedCore: true, minglaInternalTenantId: TENANT } },
    });
    expect(out.tenant).toBe(TENANT);
  });

  it("refuses a write naming another site's tenant", async () => {
    await expect(run(bindRequestTenant, { data: { tenant: OTHER }, operation: "create", req: { user: studio, context: {} } }))
      .rejects.toThrow("FORBIDDEN");
    await expect(run(bindRequestTenant, { data: { tenant: { id: OTHER } }, operation: "create", req: { user: studio, context: {} } }))
      .rejects.toThrow("FORBIDDEN");
  });

  it("refuses editing another site's document (no moves between sites)", async () => {
    await expect(run(bindRequestTenant, {
      data: { title: "x" },
      originalDoc: { tenant: OTHER },
      operation: "update",
      req: { user: studio, context: {} },
    })).rejects.toThrow("FORBIDDEN");
  });

  it("refuses a write with no session and no signed tenant", async () => {
    await expect(run(bindRequestTenant, { data: {}, operation: "create", req: { user: null, context: {} } }))
      .rejects.toThrow("FORBIDDEN");
  });
});

describe("#2829 every tenant content collection binds its writes", () => {
  it("each tenant-scoped content collection in payload.config binds writes with bindRequestTenant", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../payload.config.ts"), "utf8");
    const block = source.slice(source.indexOf("multiTenantPlugin({"), source.indexOf("tenantsSlug"));
    const tenantCollections = [...block.matchAll(/^\s*"?([a-z-]+)"?:\s*\{\}/gm)].map((match) => match[1]!);
    const bySlug = new Map<string, CollectionConfig>(TENANT_MEDIA_HOLDERS.map((holder) => [holder.slug, holder]));
    const checked: string[] = [];
    for (const slug of tenantCollections) {
      if (NON_CONTENT_TENANT_COLLECTIONS.includes(slug)) continue;
      const config = bySlug.get(slug);
      expect(config, `no collection config for tenant collection "${slug}"`).toBeDefined();
      expect(config!.hooks?.beforeChange ?? [], `"${slug}" does not bind writes to the session's tenant`).toContain(bindRequestTenant);
      checked.push(slug);
    }
    expect(checked).toEqual(expect.arrayContaining(["pages", "navigation", "footer", "site-settings", "destinations", "stories", "categories", "testimonials"]));
  });

  it("a Studio REST page create with no tenant is stored on the editor's site, not as an orphan", async () => {
    const payload = {
      find: async () => ({ docs: [], totalDocs: 0 }),
    };
    let data: Doc = { slug: "", title: "Home", kind: "standard", blocks: [], revision: 1 };
    for (const hook of Pages.hooks?.beforeChange ?? []) {
      data = (await run(hook, { data, operation: "create", req: { user: studio, context: {}, payload } })) ?? data;
    }
    expect(data.tenant).toBe(TENANT);
  });
});

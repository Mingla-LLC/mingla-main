/*
 * #4572 item 16 — tester adversarial (different angle from mediaPickerQuery).
 *
 * The implementor proved a Studio member can now RUN every picker's query.
 * This suite attacks what that widening must NOT allow:
 *   A-1  exactly three Media fields gained member read (state, kind,
 *        detected_mime). Every other system field stays system-only for read,
 *        create and update — a new field quietly switched to member read
 *        fails here.
 *   A-2  a member cannot use a filter as an ORACLE on a secret field: every
 *        system-only field (signed/stream URLs, storage keys, checksum,
 *        rendition manifest, dimensions) is still "cannot be queried".
 *   A-3  no member, no read: anonymous, a session with rank < 20, and a
 *        member without a rank are refused on all three picker fields, and
 *        cannot query `state`.
 *   A-4  the widened field read is never the tenant boundary: the collection
 *        read for a member is a tenant constraint, and a member with no
 *        tenant reads nothing; no picker filter offers media for a session
 *        without a tenant.
 *   A-5  only Mingla's system writes the three fields (a member's create or
 *        update of `state` is refused even with READY data).
 *   A-6  the Studio settings attach accepts only the logo / social image and
 *        a well-formed id at the current revision.
 * FAILS-ON-REVERT: widening any other field (A-1/A-2), dropping the rank
 * check in tenantFieldAccess (A-3), or letting pickerFieldAccess write (A-5).
 */
import { describe, expect, it } from "vitest";
import { flattenAllFields, validateQueryPaths, type Field } from "payload";
import { Media } from "./Media";
import { SiteSettings } from "./SiteSettings";
import { tenantRead } from "../lib/access";
import { applyStudioSettingsSelection } from "../lib/studioMediaSelection";

type Access = { read?: (a: { req: unknown }) => unknown; create?: (a: { req: unknown }) => unknown; update?: (a: { req: unknown }) => unknown };
type NamedField = Field & { name?: string; access?: Access };

const TENANT = "22222222-2222-4222-8222-222222222222";
const member = { user: { id: "m", tenantId: TENANT, siteId: "s", rank: 20, collection: "studio-users" }, context: {} };
const owner = { user: { id: "o", tenantId: TENANT, siteId: "s", rank: 60, collection: "studio-users" }, context: {} };
const viewer = { user: { id: "v", tenantId: TENANT, siteId: "s", rank: 10, collection: "studio-users" }, context: {} };
const noRank = { user: { id: "n", tenantId: TENANT, siteId: "s", collection: "studio-users" }, context: {} };
const noTenant = { user: { id: "t", siteId: "s", rank: 60, collection: "studio-users" }, context: {} };
const anon = { user: null, context: {} };
const granted = { user: member.user, context: { minglaMediaGrant: true } };

const PICKER_FIELDS = ["state", "kind", "detected_mime"].sort();
const fields = Media.fields as NamedField[];
const withAccess = fields.filter((f) => f.name && f.access);

const mediaFields: Field[] = [...(Media.fields as Field[]), { name: "tenant", type: "text" } as Field];
const mediaConfig = { ...Media, fields: mediaFields, flattenedFields: flattenAllFields({ fields: mediaFields }) };
function request(base: Base) {
  return { ...base, locale: undefined, payload: { collections: { media: { config: mediaConfig } }, config: { localization: false } } };
}
type Base = { user: unknown; context: Record<string, unknown> };
async function query(where: unknown, base: Base = member) {
  await validateQueryPaths({ collectionConfig: mediaConfig as never, overrideAccess: false, req: request(base) as never, where: where as never });
}

describe("#4572 item 16 tester — the picker widening is exactly three readable fields", () => {
  it("A-1 only state, kind and detected_mime are member-readable; every other system field is not", () => {
    const memberReadable = withAccess.filter((f) => f.access!.read?.({ req: owner }) === true).map((f) => f.name!).sort();
    expect(memberReadable).toEqual(PICKER_FIELDS);
    // the system-only set is not empty and still reads for Mingla's own system
    const systemOnly = withAccess.filter((f) => !PICKER_FIELDS.includes(f.name!));
    expect(systemOnly.map((f) => f.name)).toEqual(expect.arrayContaining([
      "stream_url", "stream_video_id", "stream_host", "quarantine_key", "approved_master_key",
      "rendition_manifest", "checksum", "bytes", "width", "height",
    ]));
    for (const f of systemOnly) {
      expect(f.access!.read?.({ req: owner }), `${f.name} member read`).not.toBe(true);
      expect(f.access!.read?.({ req: granted }), `${f.name} system read`).toBe(true);
    }
  });

  it("A-2 a member cannot filter on any system-only field (no oracle on URLs, keys or checksums)", async () => {
    const secret = withAccess.filter((f) => !PICKER_FIELDS.includes(f.name!)).map((f) => f.name!);
    const leaks: string[] = [];
    for (const name of secret) {
      for (const op of ["equals", "like", "exists"]) {
        try {
          await query({ [name]: { [op]: op === "exists" ? true : "a" } }, owner);
          leaks.push(`${name}.${op}`);
        } catch (error) {
          expect((error as Error).message).toMatch(/cannot be queried/);
        }
      }
    }
    // nested under and/or too
    await expect(query({ and: [{ state: { equals: "READY" } }, { or: [{ stream_url: { like: "https" } }] }] }, owner)).rejects.toThrow(/cannot be queried/);
    expect(leaks).toEqual([]);
  });

  it("A-3 anonymous, a viewer (rank 10) and a rankless session cannot read or query the picker fields", async () => {
    for (const name of PICKER_FIELDS) {
      const access = fields.find((f) => f.name === name)!.access!;
      for (const [who, req] of [["anon", anon], ["viewer", viewer], ["no rank", noRank]] as const) {
        expect(Boolean(access.read?.({ req })), `${name} ${who} read`).toBe(false);
      }
    }
    for (const base of [anon, viewer, noRank]) {
      await expect(query({ state: { equals: "READY" } }, base)).rejects.toThrow(/cannot be queried/);
    }
  });

  it("A-4 the collection read is the tenant boundary; no tenant means no media", () => {
    expect(tenantRead({ req: member } as never)).toEqual({ tenant: { equals: TENANT } });
    expect(tenantRead({ req: noTenant } as never)).toBe(false);
    expect(tenantRead({ req: viewer } as never)).toBe(false);
    expect(tenantRead({ req: anon } as never)).toBe(false);
    const logo = (SiteSettings.fields as Array<NamedField & { filterOptions?: (a: { req: unknown }) => unknown }>).find((f) => f.name === "logo")!;
    expect(logo.filterOptions!({ req: noTenant })).toBe(false);
    expect(logo.filterOptions!({ req: anon })).toBe(false);
    // the filter scopes to the caller's own tenant, never one named in input
    expect(logo.filterOptions!({ req: member })).toEqual({ tenant: { equals: TENANT }, state: { equals: "READY" } });
  });

  it("A-5 only Mingla's system writes the three picker fields", () => {
    for (const name of PICKER_FIELDS) {
      const access = fields.find((f) => f.name === name)!.access!;
      for (const req of [member, owner, anon, viewer, noTenant]) {
        expect(Boolean(access.create?.({ req })), `${name} create`).toBe(false);
        expect(Boolean(access.update?.({ req })), `${name} update`).toBe(false);
      }
      expect(access.update?.({ req: granted })).toBe(true);
      expect(access.update?.({ req: { user: null, context: { minglaSignedCore: true } } })).toBe(true);
    }
  });
});

describe("#4572 item 16 tester — Studio settings attach refuses anything but the logo or social image", () => {
  const settings = { id: 7, updatedAt: "2026-11-23T10:00:00.000Z", logo: null, social_image: null };
  const id = "33333333-3333-4333-8333-333333333333";

  it("A-6 another settings field, a non-UUID id, or a stale revision is refused", () => {
    for (const field of ["tenant", "design", "logo ", "LOGO", "__proto__", null, undefined, ["logo"]]) {
      expect(() => applyStudioSettingsSelection(settings, id, { expectedRevision: settings.updatedAt, field }), String(field)).toThrow();
    }
    for (const bad of ["", "1", "../x", `${id}x`, "33333333-3333-4333-8333-33333333333g"]) {
      expect(() => applyStudioSettingsSelection(settings, bad, { expectedRevision: settings.updatedAt, field: "logo" }), bad).toThrow(/REVISION_CONFLICT/);
    }
    expect(() => applyStudioSettingsSelection(settings, id, { expectedRevision: "", field: "logo" })).toThrow(/REVISION_CONFLICT/);
    expect(() => applyStudioSettingsSelection({ ...settings, updatedAt: undefined }, id, { expectedRevision: "x", field: "logo" })).toThrow(/REVISION_CONFLICT/);
    expect(applyStudioSettingsSelection(settings, id, { expectedRevision: settings.updatedAt, field: "social_image" })).toEqual({ social_image: id });
    // the change carries exactly one key: nothing else on the settings can ride along
    expect(Object.keys(applyStudioSettingsSelection(settings, id, { expectedRevision: settings.updatedAt, field: "logo" }))).toEqual(["logo"]);
  });
});

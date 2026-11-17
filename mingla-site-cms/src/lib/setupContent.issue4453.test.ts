/*
 * #4453 PR 3 (spec v1 §3.4, SC-3.4) — Build creates the owner's setup entries.
 *
 * invariant: I-SITES-NO-INVENTED-PROOF (declared in
 * supabase/migrations/20280725014453_issue_4453_website_proof_part.sql).
 * Pinned here: a staged review without its confirmer refuses the Build; each
 * entry copies the owner's words verbatim (no field filled in); a review is
 * created confirmed by the member who ticked it and enabled; a rerun finds
 * the entry by its setup_ref and creates nothing (no duplicates); and the
 * compose body accepts the new keys only in their exact shape.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./observability", () => ({ emitCmsObservation: vi.fn(), observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));
vi.mock("./gateway", () => ({ callCore: vi.fn(), verifyCoreRequest: vi.fn(), readCoreProjection: vi.fn() }));

import { entryDataFor, freeSlugFrom, materializeSetupContent, parseStagedRows, type StagedSetupRow } from "./setupContent";
import { parseComposeBody } from "../endpoints/composeEndpoint";

const OWNER = "00000000-0000-4000-8000-00000000a001";
const ADMIN = "00000000-0000-4000-8000-00000000a002";
const ROW = "00000000-0000-4000-8000-00000000b001";
const review = { id: ROW, kind: "review", payload: { reviewer: "Tolu A.", quote: "Best week of my year.", review_date: "2026-03", source: "Google, March 2026" }, confirmed_real_by: ADMIN };

describe("#4453 parseStagedRows", () => {
  it("refuses a review that carries no confirmer (Constitution rule 9)", () => {
    expect(() => parseStagedRows([{ ...review, confirmed_real_by: null }])).toThrow("VALIDATION_FAILED");
    expect(() => parseStagedRows([{ ...review, kind: "testimonial" }])).toThrow("VALIDATION_FAILED");
    expect(parseStagedRows(undefined)).toEqual([]);
    expect(parseStagedRows([review])[0]).toMatchObject({ kind: "review", confirmed_real_by: ADMIN });
  });
});

describe("#4453 entryDataFor copies the owner's words only", () => {
  it("review: verbatim, confirmed, enabled; no trip name invented", () => {
    const data = entryDataFor(parseStagedRows([review])[0]!, "t1", "", "2026-11-16");
    expect(data).toEqual({ tenant: "t1", quote: "Best week of my year.", reviewer: "Tolu A.", review_date: "2026-03-01", source_note: "Google, March 2026", confirmed_real: true, enabled: true });
  });
  it("destination: only the fields given (no language, currency or facts)", () => {
    const row: StagedSetupRow = { id: ROW, kind: "destination", payload: { name: "Lisbon" }, confirmed_real_by: null };
    expect(entryDataFor(row, "t1", "lisbon", "2026-11-16")).toEqual({ tenant: "t1", title: "Lisbon", slug: "lisbon", enabled: true });
  });
  it("story: the owner's text as paragraphs", () => {
    const row: StagedSetupRow = { id: ROW, kind: "story", payload: { title: "Our first trip", story: "It rained.\n\nWe danced." }, confirmed_real_by: null };
    const data = entryDataFor(row, "t1", "our-first-trip", "2026-11-16") as { content: { root: { children: { children: { text: string }[] }[] } } };
    expect(data.content.root.children.map((p) => p.children[0]!.text)).toEqual(["It rained.", "We danced."]);
  });
  it("slugs are free and readable", () => {
    expect(freeSlugFrom("São Paulo", new Set(["sao-paulo"]))).toBe("sao-paulo-2");
  });
});

describe("#4453 materializeSetupContent (SC-3.4)", () => {
  function fakePayload() {
    const docs: Record<string, Record<string, unknown>[]> = { testimonials: [], destinations: [], stories: [] };
    const creates: { collection: string; req: { user: { id: string }; context: Record<string, unknown> }; data: Record<string, unknown> }[] = [];
    const payload = {
      find: async ({ collection, where }: { collection: string; where: { and?: { setup_ref?: { equals: string } }[] } }) => {
        const ref = where.and?.find((clause) => clause.setup_ref)?.setup_ref?.equals;
        return { docs: (docs[collection] ?? []).filter((doc) => ref === undefined || doc.setup_ref === ref) };
      },
      create: async ({ collection, req, data }: { collection: string; req: never; data: Record<string, unknown> }) => {
        const doc = { id: String(docs[collection]!.length + 1), ...data, setup_ref: (req as { context: { minglaSetupRef: string } }).context.minglaSetupRef };
        docs[collection]!.push(doc);
        creates.push({ collection, req, data });
        return doc;
      },
    };
    return { req: { context: {}, payload } as never, docs, creates };
  }

  it("creates each entry once, the review as its confirmer; a rerun creates nothing", async () => {
    const fake = fakePayload();
    const rows = parseStagedRows([review, { id: "00000000-0000-4000-8000-00000000b002", kind: "destination", payload: { name: "Lisbon" }, confirmed_real_by: null }]);
    const input = { tenantId: "t1", siteId: "s1", brandId: "b1", userId: OWNER, rows };
    const first = await materializeSetupContent(fake.req, input);
    expect(first).toEqual([{ id: ROW, entry_id: "1", collection: "testimonials" }, { id: "00000000-0000-4000-8000-00000000b002", entry_id: "1", collection: "destinations" }]);
    expect(fake.creates[0]!.req.user.id).toBe(ADMIN);
    expect(fake.creates[0]!.req.context).toMatchObject({ minglaSignedCore: true, minglaConfirmReview: true, minglaSetupRef: ROW });
    expect(fake.creates[1]!.req.context.minglaConfirmReview).toBeUndefined();
    const again = await materializeSetupContent(fake.req, input);
    expect(again.map((row) => row.entry_id)).toEqual(["1", "1"]);
    expect(fake.creates).toHaveLength(2);
  });
});

describe("#4453 compose body", () => {
  const SITE = "00000000-0000-4000-8000-00000000c001";
  const base = { kind: "compose_from_plan", site_id: SITE, brand_id: "00000000-0000-4000-8000-00000000c002", user_id: OWNER, plan: { offerings_selected: ["trips"] }, brand: { name: "Proof" } };
  it("accepts review_drafts and setup_content; refuses a bad shape", () => {
    expect(parseComposeBody(base, SITE)).toMatchObject({ reviewDrafts: false, setupContent: [] });
    expect(parseComposeBody({ ...base, review_drafts: true, setup_content: [review] }, SITE)).toMatchObject({ reviewDrafts: true, setupContent: [{ id: ROW }] });
    expect(parseComposeBody({ ...base, review_drafts: "yes" }, SITE)).toBeNull();
    expect(parseComposeBody({ ...base, setup_content: [{ ...review, confirmed_real_by: null }] }, SITE)).toBeNull();
  });
});

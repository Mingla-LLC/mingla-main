import type { PayloadRequest } from "payload";
import { scopedRequest } from "../endpoints/contentEndpoint";

/*
 * #4453 (spec v1 §3.4) — Build creates the owner's Website-setup entries
 * (Q1 reviews, Q3 destinations, Q4 stories) in Studio BEFORE composing, so
 * the composer sees them. Each entry is the owner's own words, unchanged:
 *   - reviews: confirmed as real by the member who ticked "This is a real
 *     review" in setup (Core recorded who, rank 50), enabled;
 *   - destinations and stories: enabled (the owner wrote them), not Ari's.
 * Idempotent: an entry already created for a staged row (`setup_ref`) is
 * reused, so a rerun of Build creates no duplicates.
 *
 * invariant: I-SITES-NO-INVENTED-PROOF — a staged review is created only with
 * its confirmer (test: setupContent.issue4453.test.ts).
 */

type AnyDoc = Record<string, unknown>;
type Kind = "review" | "destination" | "story";

export type StagedSetupRow = {
  id: string;
  kind: Kind;
  payload: AnyDoc;
  confirmed_real_by: string | null;
};

export type MaterializedRow = { id: string; entry_id: string; collection: "testimonials" | "destinations" | "stories" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTION: Record<Kind, MaterializedRow["collection"]> = { review: "testimonials", destination: "destinations", story: "stories" };

const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : null;

/** The staged rows Core signed in, shape-checked (a malformed row refuses the whole Build). */
export function parseStagedRows(value: unknown): StagedSetupRow[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 60) throw new Error("VALIDATION_FAILED");
  return value.map((row) => {
    if (!row || typeof row !== "object") throw new Error("VALIDATION_FAILED");
    const record = row as AnyDoc;
    const kind = record.kind;
    if (typeof record.id !== "string" || !UUID.test(record.id)) throw new Error("VALIDATION_FAILED");
    if (kind !== "review" && kind !== "destination" && kind !== "story") throw new Error("VALIDATION_FAILED");
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) throw new Error("VALIDATION_FAILED");
    const confirmer = typeof record.confirmed_real_by === "string" && UUID.test(record.confirmed_real_by) ? record.confirmed_real_by : null;
    // No review without the member who confirmed it is real (Constitution rule 9).
    if (kind === "review" && !confirmer) throw new Error("VALIDATION_FAILED");
    return { id: record.id.toLowerCase(), kind, payload: record.payload as AnyDoc, confirmed_real_by: confirmer };
  });
}

/** Plain text → Lexical paragraphs (the story body). */
export function plainTextToLexical(value: string): AnyDoc {
  const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return {
    root: {
      type: "root", format: "", indent: 0, version: 1, direction: "ltr",
      children: (paragraphs.length ? paragraphs : [""]).map((text) => ({
        type: "paragraph", format: "", indent: 0, version: 1, direction: "ltr", textFormat: 0, textStyle: "",
        children: text ? [{ type: "text", detail: 0, format: 0, mode: "normal", style: "", text, version: 1 }] : [],
      })),
    },
  };
}

export function slugBase(value: string): string {
  const base = value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  return base || "entry";
}

export function freeSlugFrom(wanted: string, taken: ReadonlySet<string>): string {
  const base = slugBase(wanted);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("VALIDATION_FAILED");
}

/** The entry data for one staged row: the owner's fields, copied verbatim. */
export function entryDataFor(row: StagedSetupRow, tenantId: string, slug: string, today: string): AnyDoc {
  const p = row.payload;
  if (row.kind === "review") {
    const month = typeof p.review_date === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.review_date) ? p.review_date : null;
    if (!month) throw new Error("VALIDATION_FAILED");
    return {
      tenant: tenantId,
      quote: str(p.quote, 1200),
      reviewer: str(p.reviewer, 80),
      review_date: `${month}-01`,
      ...(str(p.trip_name, 120) ? { trip_name: str(p.trip_name, 120) } : {}),
      source_note: str(p.source, 500),
      confirmed_real: true,
      enabled: true,
    };
  }
  if (row.kind === "destination") {
    return {
      tenant: tenantId,
      title: str(p.name, 120),
      slug,
      ...(str(p.country, 80) ? { country: str(p.country, 80) } : {}),
      ...(str(p.short_line, 200) ? { tagline: str(p.short_line, 200) } : {}),
      ...(str(p.summary, 600) ? { summary: str(p.summary, 600) } : {}),
      enabled: true,
    };
  }
  const body = str(p.story, 5000);
  if (!body) throw new Error("VALIDATION_FAILED");
  return {
    tenant: tenantId,
    title: str(p.title, 160),
    slug,
    published_at: today,
    ...(str(p.summary, 400) ? { excerpt: str(p.summary, 400) } : {}),
    content: plainTextToLexical(body),
    enabled: true,
  };
}

/** Creates (or finds) the Studio entry for every staged row; returns what Core stamps. */
export async function materializeSetupContent(
  req: PayloadRequest,
  input: { tenantId: string; siteId: string; brandId: string; userId: string; rows: readonly StagedSetupRow[] },
): Promise<MaterializedRow[]> {
  const out: MaterializedRow[] = [];
  const takenSlugs = new Map<MaterializedRow["collection"], Set<string>>();
  const today = new Date().toISOString().slice(0, 10);
  for (const row of input.rows) {
    const collection = COLLECTION[row.kind];
    const existing = (await req.payload.find({
      collection,
      overrideAccess: true,
      draft: true,
      depth: 0,
      limit: 1,
      where: { and: [{ tenant: { equals: input.tenantId } }, { setup_ref: { equals: row.id } }] },
    })).docs[0] as unknown as AnyDoc | undefined;
    if (existing) {
      out.push({ id: row.id, entry_id: String(existing.id), collection });
      continue;
    }
    let taken = takenSlugs.get(collection);
    if (!taken && collection !== "testimonials") {
      const docs = (await req.payload.find({
        collection, overrideAccess: true, draft: true, depth: 0, pagination: false,
        where: { tenant: { equals: input.tenantId } },
      })).docs as unknown as AnyDoc[];
      taken = new Set(docs.map((doc) => String(doc.slug ?? "")));
      takenSlugs.set(collection, taken);
    }
    const wanted = row.kind === "destination" ? String(row.payload.name ?? "") : String(row.payload.title ?? "");
    const slug = taken ? freeSlugFrom(wanted, taken) : "";
    taken?.add(slug);
    // A review is created as the member who confirmed it (rank 50, checked by Core).
    const scoped = scopedRequest(req, {
      action: "setup_materialize",
      userId: row.kind === "review" && row.confirmed_real_by ? row.confirmed_real_by : input.userId,
      siteId: input.siteId,
      brandId: input.brandId,
      rank: 50,
      args: {},
    } as never, input.tenantId, {
      minglaSetupRef: row.id,
      ...(row.kind === "review" ? { minglaConfirmReview: true } : {}),
    });
    const doc = await req.payload.create({
      collection,
      req: scoped,
      overrideAccess: false,
      draft: false,
      depth: 0,
      data: entryDataFor(row, input.tenantId, slug, today) as never,
    }) as unknown as AnyDoc;
    out.push({ id: row.id, entry_id: String(doc.id), collection });
  }
  return out;
}

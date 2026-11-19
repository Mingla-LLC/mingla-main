/**
 * #4453 website workspace — the test kit the workspace suites share.
 *
 * Payload's STORAGE is faked (an in-memory store that answers `where`, sort,
 * limit and page the way the suites need); everything above it is real: the
 * content and Ari endpoints, and the Pages, Site settings and Navigation
 * `beforeChange` hooks (the revision check, the tenant binding, the ready-media
 * check, the booking gate and the review stamp). Core's signature is the only
 * other thing faked (each suite mocks `lib/gateway`).
 */
import type { PayloadRequest } from "payload";
import { Pages } from "../collections/Pages";
import { SiteSettings } from "../collections/SiteSettings";
import { Navigation } from "../collections/Navigation";

export type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SITE = "44530000-0000-4000-8000-00000000c001";
export const BRAND = "44530000-0000-4000-8000-00000000c002";
export const USER = "44530000-0000-4000-8000-00000000c003";
export const TEAMMATE = "44530000-0000-4000-8000-00000000c004";
export const TENANT = "44530000-0000-4000-8000-00000000c005";
export const EVENT = "44530000-0000-4000-8000-00000000c006";
export const PHOTO_A = "44530000-0000-4000-8000-0000000d0001";
export const PHOTO_B = "44530000-0000-4000-8000-0000000d0002";
export const PHOTO_C = "44530000-0000-4000-8000-0000000d0003";
export const PHOTO_PROCESSING = "44530000-0000-4000-8000-0000000d0004";
export const VIDEO = "44530000-0000-4000-8000-0000000d0005";
export const LONG_VIDEO = "44530000-0000-4000-8000-0000000d0006";

const HOOKED: Record<string, typeof Pages> = { pages: Pages, "site-settings": SiteSettings, navigation: Navigation };

const idOf = (value: unknown) => (value && typeof value === "object" ? String((value as Doc).id ?? "") : String(value ?? ""));

/** Payload's `where`, as far as these suites use it. */
export function matches(where: unknown, doc: Doc): boolean {
  if (!where || typeof where !== "object") return true;
  return Object.entries(where as Doc).every(([key, rule]) => {
    if (key === "and") return (rule as unknown[]).every((part) => matches(part, doc));
    if (key === "or") return (rule as unknown[]).some((part) => matches(part, doc));
    const value = doc[key];
    const test = rule as Doc;
    if ("equals" in test && idOf(value) !== idOf(test.equals)) return false;
    if ("not_equals" in test && idOf(value) === idOf(test.not_equals)) return false;
    if ("in" in test && !(test.in as unknown[]).map(idOf).includes(idOf(value))) return false;
    if ("less_than" in test && !(value < test.less_than)) return false;
    if ("greater_than" in test && !(value > test.greater_than)) return false;
    return true;
  });
}

function sorted(docs: Doc[], sort: unknown): Doc[] {
  const keys = (Array.isArray(sort) ? sort : typeof sort === "string" ? [sort] : []) as string[];
  if (!keys.length) return docs;
  return [...docs].sort((a, b) => {
    for (const raw of keys) {
      const down = raw.startsWith("-");
      const key = down ? raw.slice(1) : raw;
      const left = a[key] ?? null;
      const right = b[key] ?? null;
      if (left === right) continue;
      if (left === null) return 1;
      if (right === null) return -1;
      return (left < right ? -1 : 1) * (down ? -1 : 1);
    }
    return 0;
  });
}

const rowId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Payload gives every block and array row an id; so does this store. */
function withRowIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object" && !Array.isArray(item) && !("root" in item)
      ? { id: (item as Doc).id ?? rowId(), ...(withRowIds(item) as Doc) }
      : item));
  }
  if (value && typeof value === "object") {
    const out: Doc = {};
    for (const [key, inner] of Object.entries(value as Doc)) out[key] = key === "review" || key === "content" ? inner : withRowIds(inner);
    return out;
  }
  return value;
}

/** Only the collections with rows (blocks, menu items) get row ids; a stored JSON value is kept as written. */
const shaped = (collection: string, doc: Doc): Doc => (collection === "pages" || collection === "navigation" ? withRowIds(doc) as Doc : doc);

export type Store = ReturnType<typeof makeStore>;

export function makeStore() {
  const data = new Map<string, Doc[]>();
  const rows = (collection: string) => {
    if (!data.has(collection)) data.set(collection, []);
    return data.get(collection)!;
  };
  let clock = 0;
  /** Each write gets its own instant, in step with the (possibly faked) system clock. */
  const stamp = () => {
    clock = Math.max(clock + 1, Date.now());
    return new Date(clock).toISOString();
  };
  async function hooked(collection: string, next: Doc, originalDoc: Doc | undefined, req: PayloadRequest, operation: "create" | "update") {
    const config = HOOKED[collection];
    if (!config) return next;
    let out = next;
    for (const hook of config.hooks?.beforeChange ?? []) {
      out = ((await hook({ data: out, originalDoc, req, operation, collection: config, context: req?.context ?? {} } as never)) ?? out) as Doc;
    }
    return out;
  }
  const payload = {
    db: undefined,
    find: async ({ collection, where, sort, limit, page, pagination }: Doc) => {
      const all = sorted(rows(collection).filter((doc) => matches(where, doc)), sort);
      const size = pagination === false || !limit ? all.length : Number(limit);
      const start = (Math.max(Number(page ?? 1), 1) - 1) * (size || 1);
      const docs = pagination === false || !limit ? all : all.slice(start, start + size);
      return { docs: docs.map((doc) => structuredClone(doc)), totalDocs: all.length };
    },
    findByID: async ({ collection, id }: Doc) => {
      const doc = rows(collection).find((row) => String(row.id) === String(id));
      if (!doc) throw new Error("NOT_FOUND");
      return structuredClone(doc);
    },
    count: async ({ collection, where }: Doc) => ({ totalDocs: rows(collection).filter((doc) => matches(where, doc)).length }),
    create: async ({ collection, data: input, req }: Doc) => {
      const next = await hooked(collection, input as Doc, undefined, req, "create");
      const at = stamp();
      const stored = shaped(collection, { ...next, id: (input as Doc).id ?? crypto.randomUUID(), createdAt: at, updatedAt: at });
      rows(collection).push(stored);
      return structuredClone(stored);
    },
    update: async ({ collection, id, where, data: input, req }: Doc) => {
      const targets = rows(collection).filter((doc) => (id !== undefined ? String(doc.id) === String(id) : matches(where, doc)));
      if (id !== undefined && !targets.length) throw new Error("NOT_FOUND");
      let last: Doc | null = null;
      for (const original of targets) {
        // Payload fills every field the caller left out from the stored document BEFORE the collection hooks
        // run (fields/hooks/beforeValidate: the fallback value), so a hook sees the whole document.
        const { id: _id, createdAt: _created, updatedAt: _updated, ...existing } = structuredClone(original);
        const next = await hooked(collection, { ...existing, ...(input as Doc) }, structuredClone(original), req, "update");
        Object.assign(original, shaped(collection, next), { updatedAt: stamp() });
        last = original;
      }
      return id !== undefined ? structuredClone(last!) : { docs: targets.map((doc) => structuredClone(doc)) };
    },
    delete: async ({ collection, id, where }: Doc) => {
      const all = rows(collection);
      const keep = all.filter((doc) => !(id !== undefined ? String(doc.id) === String(id) : matches(where, doc)));
      data.set(collection, keep);
      return { docs: [] };
    },
  };
  return { payload, rows };
}

/** A signed Mingla request as a member of this site (what the endpoints build from Core's body). */
export function memberRequest(store: Store, context: Doc = {}, userId = USER): PayloadRequest {
  return {
    payload: store.payload,
    context: { minglaSignedCore: true, ...context },
    user: { id: userId, collection: "studio-users", siteId: SITE, brandId: BRAND, tenantId: TENANT, rank: 50, tenants: [{ tenant: TENANT }] },
  } as unknown as PayloadRequest;
}

const paragraphs = (text: string) => ({
  root: {
    type: "root", format: "", indent: 0, version: 1, direction: "ltr",
    children: [{ type: "paragraph", format: "", indent: 0, version: 1, direction: "ltr", textFormat: 0, textStyle: "", children: [{ type: "text", detail: 0, format: 0, mode: "normal", style: "", text, version: 1 }] }],
  },
});

/** A site the composer built (every section a Draft), in the Pop design, with two pages and a menu. */
export async function seedSite(design = "pop"): Promise<Store & { homeId: string; aboutId: string; settingsId: string; navigationId: string }> {
  const store = makeStore();
  store.rows("tenants").push({ id: TENANT, core_site_id: SITE, core_brand_id: BRAND, status: "active" });
  const image = { tenant: TENANT, state: "READY", kind: "image", detected_mime: "image/jpeg" };
  store.rows("media").push(
    { id: PHOTO_A, ...image, original_filename_safe: "arcade-floor.jpg", rendition_manifest: { renditions: [{ key: `r/${PHOTO_A}/640.jpg`, width: 640 }] } },
    { id: PHOTO_B, ...image, original_filename_safe: "console-wall.jpg" },
    { id: PHOTO_C, ...image, original_filename_safe: "friday-crowd.jpg" },
    { id: PHOTO_PROCESSING, tenant: TENANT, state: "PROCESSING", kind: "image", detected_mime: "image/jpeg", original_filename_safe: "new-upload.jpg" },
    { id: VIDEO, tenant: TENANT, state: "READY", kind: "video", detected_mime: "video/mp4", duration_ms: 8000, original_filename_safe: "loop.mp4" },
    { id: LONG_VIDEO, tenant: TENANT, state: "READY", kind: "video", detected_mime: "video/mp4", duration_ms: 60000, original_filename_safe: "long.mp4" },
  );
  const composer = memberRequest(store, { minglaReviewSource: "composer" });
  const settings = await store.payload.create({ collection: "site-settings", req: composer, data: { tenant: TENANT, display_name: "Gameland", design } });
  const home = await store.payload.create({
    collection: "pages",
    req: composer,
    data: {
      tenant: TENANT, title: "Home", slug: "", kind: "standard", enabled: true,
      blocks: [
        { blockType: "hero", variant: "pop-stack", heading: "Play together", subheading: "Game nights in Lagos.", media: PHOTO_A, ctas: [{ label: "See what's on", href: "/events" }] },
        { blockType: "rich_text", variant: "manifesto", heading: "Our story", content: paragraphs("We run game nights for friends."), width: "narrow" },
        { blockType: "faq", variant: "split", heading: "Good to know", items: [{ question: "Can I bring friends?", answer: "Yes, bring your squad." }, { question: "Is there food?", answer: "Snacks are on sale." }] },
        { blockType: "offering_grid", variant: "cards", heading: "What's on", mode: "upcoming", kind: "event" },
        { blockType: "gallery", variant: "mosaic", heading: "Inside", images: [{ media: PHOTO_A, alt: "The arcade floor" }, { media: PHOTO_B }] },
      ],
    },
  });
  const about = await store.payload.create({
    collection: "pages",
    req: composer,
    data: {
      tenant: TENANT, title: "About", slug: "about", kind: "standard", enabled: true,
      blocks: [
        { blockType: "page_header", variant: "neutral", heading: "About us" },
        { blockType: "rich_text", variant: "manifesto", heading: "Who we are", content: paragraphs("Hosts who play too."), width: "narrow" },
      ],
    },
  });
  const navigation = await store.payload.create({
    collection: "navigation",
    req: composer,
    data: { tenant: TENANT, items: [{ label: "About", target_type: "page", page: about.id }, { label: "Instagram", target_type: "url", url: "https://instagram.com/gameland" }] },
  });
  return { ...store, homeId: String(home.id), aboutId: String(about.id), settingsId: String(settings.id), navigationId: String(navigation.id) };
}

/** The raw request an endpoint handler receives (Core's signature is mocked by the suite). */
export function signedRequest(store: Store, body: Doc): PayloadRequest {
  const raw = JSON.stringify(body);
  return { text: async () => raw, headers: new Headers(), method: "POST", payload: store.payload, context: {}, user: null } as unknown as PayloadRequest;
}

export const pageOf = (store: Store, id: string): Doc => store.rows("pages").find((page) => String(page.id) === id)!;
export const blocksOf = (store: Store, id: string): Doc[] => pageOf(store, id).blocks as Doc[];
export const revisionOf = (store: Store, id: string): string => String(pageOf(store, id).revision);

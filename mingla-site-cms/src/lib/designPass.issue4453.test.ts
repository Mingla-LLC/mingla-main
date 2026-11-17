/*
 * #4453 milestone 7 — Ari's design pass in Studio (SC-A1, SC-A2, D6, D7):
 * the flag gates it, Ari is refused an "avoid" style (STYLE_DOES_NOT_FIT),
 * the look-alike check only warns, it runs once per draft, and everything it
 * writes goes to the draft through composer v2.
 *
 * invariant: I-SITES-ARI-NEVER-PICKS-AVOID (declared in formats.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tenantPages", () => ({ findAllTenantPages: vi.fn(async () => []) }));
vi.mock("./designPassInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./designPassInputs")>();
  return {
    ...actual,
    loadStudioRecords: vi.fn(async () => ({
      photos: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, alt: null })),
      destination_ids: ["d1"],
      stories: 2,
      confirmed_reviews: 3,
      ready_videos: 0,
      has_logo: false,
    })),
  };
});

import { designPassClaimKey, isClaimDuplicate, runDesignPassAction } from "./designPass";
import { parseSignedDesignPass } from "./designPassInputs";
import type { AriActionContext } from "./ariSiteActions";
import { designFingerprint } from "../contracts/generated/formats.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function signed(overrides: Record<string, unknown> = {}) {
  return parseSignedDesignPass({
    plan: { offerings_selected: ["trips"], venue_descriptor: null, story: { why: "We go further together" } },
    answers: { value_points: [{ title: "Two guides", sentence: "Two guides." }, { title: "Small", sentence: "Twelve people." }], faq: [{ question: "Fit?", answer: "Yes." }], process_steps: [], quick_facts: null },
    address: null,
    facts: { upcoming: { trip: 3, event: 0, experience: 0 }, ended: { trip: 4, event: 0, experience: 0 }, next_offering: { trip: id(1) }, bookable: { trip: 2 } },
    style_library: true,
    live_fingerprints: [],
    ...overrides,
  });
}

type Write = { op: string; collection: string; data?: unknown };
let writes: Write[];
let workLog: Array<Record<string, unknown>>;
let publications: Array<{ createdAt: string }>;
let nonces: Set<string>;
let claimFailure: Error | null = null;
let clock: number;
const tick = (): string => new Date(Date.UTC(2026, 10, 16, 12, 0, clock++)).toISOString();

function ctx(designPass: ReturnType<typeof signed> | null): AriActionContext {
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: { and?: Array<Record<string, { greater_than?: string }>> } }) => {
      if (collection === "publication-jobs") return { docs: publications.slice(-1) };
      if (collection === "work-log") {
        const since = where?.and?.find((clause) => clause.createdAt)?.createdAt?.greater_than;
        return { docs: workLog.filter((entry) => !since || String(entry.createdAt) > since) };
      }
      if (collection === "navigation") return { docs: [{ id: "nav", items: [] }] };
      return { docs: [] };
    }),
    create: vi.fn(async ({ collection, data }: { collection: string; data: unknown }) => {
      if (collection === "gateway-nonces") {
        // The real column is UNIQUE: a second claim on the same key fails.
        const nonce = String((data as { nonce: string }).nonce);
        if (claimFailure) throw claimFailure;
        // Payload's shape for a Postgres 23505 on the nonce.
        if (nonces.has(nonce)) throw Object.assign(new Error("The following field is invalid: nonce"), { data: { errors: [{ path: "nonce", message: "Value must be unique" }] } });
        nonces.add(nonce);
        return { id: nonce };
      }
      writes.push({ op: "create", collection, data });
      return { id: `new-${writes.length}` };
    }),
    delete: vi.fn(async ({ collection, where }: { collection: string; where: { nonce: { equals: string } } }) => {
      if (collection === "gateway-nonces") nonces.delete(where.nonce.equals);
      return { docs: [] };
    }),
    update: vi.fn(async ({ collection, data }: { collection: string; data: unknown }) => {
      writes.push({ op: "update", collection, data });
      return {};
    }),
  };
  const req = { payload } as unknown as AriActionContext["req"];
  return {
    req,
    scoped: req,
    tenantId: "t1",
    siteId: id(90),
    brandId: id(91),
    userId: id(92),
    rank: 50,
    evidence: { brand: { id: id(91), name: "Young and Stamped", description: "Go far.\n\nSmall-group trips.", city: "London", contact_email: "hi@example.com" }, offerings: [] },
    designPass,
  };
}

const deps = {
  currentSettings: vi.fn(async () => ({ id: "settings", design: "voyage", tokens: {} })),
  writeWorkLog: vi.fn(async (_ctx: AriActionContext, entry: Record<string, unknown>) => {
    workLog.push({ ...entry, createdAt: tick() });
    return "log-1";
  }),
  assertCites: vi.fn(async () => [{ kind: "mingla_record", record_id: id(1) }]),
  decisionOf: vi.fn((value: unknown) => String(value)),
} as unknown as Parameters<typeof runDesignPassAction>[3];

const pass = (design: string, designPass = signed()) =>
  runDesignPassAction("propose_site_design_pass", { design_key: design, why: "It fits group trips.", cites: [] }, ctx(designPass), deps);

beforeEach(() => {
  writes = [];
  workLog = [];
  publications = [];
  nonces = new Set();
  claimFailure = null;
  clock = 0;
});

describe("#4453 design pass — gating and refusals", () => {
  it("refuses every action without Core's signed design pass (flag off): DESIGN_PASS_OFF", async () => {
    for (const action of ["get_site_design_brief", "propose_site_design_pass", "propose_site_chrome"]) {
      await expect(runDesignPassAction(action, {}, ctx(null), deps)).rejects.toThrow("DESIGN_PASS_OFF");
    }
    expect(writes).toEqual([]);
  });

  it("refuses an avoid style from Ari (SC-A1: STYLE_DOES_NOT_FIT) and writes nothing", async () => {
    await expect(pass("pulse")).rejects.toThrow("STYLE_DOES_NOT_FIT");
    await expect(pass("nocturne")).rejects.toThrow("STYLE_DOES_NOT_FIT");
    expect(writes).toEqual([]);
    expect(workLog).toEqual([]);
  });

  it("with the style library off Ari may name only Voyage", async () => {
    const off = signed({ style_library: false });
    await expect(pass("terra", off)).rejects.toThrow("VALIDATION_FAILED");
    await expect(pass("voyage", off)).resolves.toMatchObject({ design: "voyage", draft_only: true });
  });

  it("runs once per draft (DESIGN_PASS_ALREADY_RUN)", async () => {
    await pass("terra");
    await expect(pass("journal")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
  });

  it("is once per DRAFT, not once per site: after a publish the new draft gets one fresh pass (tester P3-1)", async () => {
    await pass("terra");
    publications.push({ createdAt: tick() }); // the owner publishes; the next edit is a new draft
    await expect(pass("journal")).resolves.toMatchObject({ design: "journal", draft_only: true });
    await expect(pass("voyage")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
  });

  it("two passes racing on one draft: exactly one runs (retest P3-2, atomic claim)", async () => {
    const results = await Promise.allSettled([pass("terra"), pass("journal")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("DESIGN_PASS_ALREADY_RUN");
    expect(workLog.filter((entry) => entry.tool === "propose_site_design_pass")).toHaveLength(1);
  });

  it("a pass that fails after claiming gives the claim back: the next pass on the same draft runs (P2-2)", async () => {
    const writeWorkLog = deps.writeWorkLog as unknown as ReturnType<typeof vi.fn>;
    writeWorkLog.mockImplementationOnce(async () => { throw new Error("work log down"); });
    await expect(pass("terra")).rejects.toThrow("work log down");
    expect(nonces.size).toBe(0);
    await expect(pass("journal")).resolves.toMatchObject({ design: "journal", draft_only: true });
  });

  it("only a real duplicate reads as DESIGN_PASS_ALREADY_RUN; any other claim error is DESIGN_PASS_TRY_AGAIN (P2-2)", async () => {
    claimFailure = new Error("connection refused");
    await expect(pass("terra")).rejects.toThrow("DESIGN_PASS_TRY_AGAIN");
    claimFailure = null;
    expect(isClaimDuplicate({ data: { errors: [{ path: "nonce", message: "Value must be unique" }] } })).toBe(true);
    expect(isClaimDuplicate({ cause: { code: "23505" } })).toBe(true);
    expect(isClaimDuplicate(new Error("connection refused"))).toBe(false);
    expect(isClaimDuplicate({ data: { errors: [{ path: "site_id", message: "required" }] } })).toBe(false);
    await expect(pass("terra")).resolves.toMatchObject({ design: "terra" });
  });

  it("the claim key is per tenant and per draft start", () => {
    expect(designPassClaimKey("t1", null)).not.toBe(designPassClaimKey("t2", null));
    expect(designPassClaimKey("t1", null)).not.toBe(designPassClaimKey("t1", "2026-11-16T12:00:00.000Z"));
    expect(designPassClaimKey("t1", "2026-11-16T12:00:00.000Z").length).toBeLessThanOrEqual(64);
  });

  it("a publish BEFORE the pass does not open a second pass on the same draft", async () => {
    publications.push({ createdAt: tick() });
    await pass("terra");
    await expect(pass("journal")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
  });
});

describe("#4453 design pass — what it writes", () => {
  it("composes the format in the chosen style into the draft, records the look and needs review", async () => {
    const result = await pass("terra");
    expect(result).toMatchObject({ design: "terra", format: "trips", draft_only: true, review_required: true });
    expect(writes.find((write) => write.collection === "site-settings")?.data).toEqual({ design: "terra" });
    const pages = writes.filter((write) => write.collection === "pages" && write.op === "create").map((write) => (write.data as { slug: string }).slug);
    expect(pages).toEqual(expect.arrayContaining(["", "trips", "about", "faq"]));
    expect(result.fingerprint).toMatchObject({ design: "terra", format: "trips" });
    expect(result).not.toHaveProperty("warnings");
    expect(workLog[0]).toMatchObject({ tool: "propose_site_design_pass", part: "composition" });
  });

  it("warns, never blocks, when a live site looks the same (D7, SIMILAR_TO_LIVE_SITE)", async () => {
    const first = await pass("terra");
    workLog = [];
    nonces.clear();
    const { format: _format, ...look } = first.fingerprint as Record<string, unknown>;
    const twin = signed({ live_fingerprints: [look] });
    const second = await pass("terra", twin);
    expect(second.warnings).toEqual([expect.objectContaining({ code: "SIMILAR_TO_LIVE_SITE" })]);
    const different = signed({ live_fingerprints: [designFingerprint({ design: "voyage", header: "pill", hero: "arch", home: [], fonts: null })] });
    workLog = [];
    nonces.clear();
    expect(await pass("terra", different)).not.toHaveProperty("warnings");
  });
});

describe("#4453 milestone 7b — propose_site_chrome footer", () => {
  const chrome = (args: Record<string, unknown>) =>
    runDesignPassAction("propose_site_chrome", { why: "Fits.", cites: [], ...args }, ctx(signed()), deps);
  it("writes a footer layout the design offers to the footer draft, and refuses one it does not", async () => {
    await expect(chrome({ footer_variant: "giant" })).resolves.toMatchObject({ changed: ["footer_variant"], draft_only: true });
    expect(writes.some((write) => (write.collection === "footer") && (write.data as Record<string, unknown>).footer_variant === "giant")).toBe(true);
    await expect(chrome({ footer_variant: "nope" })).rejects.toThrow("VARIANT_NOT_IN_DESIGN");
  });
});

describe("#4453 design brief", () => {
  it("lists the styles with fixed fit and reasons; avoid is never pickable by Ari; a taken look is marked", async () => {
    const brief = await runDesignPassAction("get_site_design_brief", {}, ctx(signed()), deps);
    expect(brief.format).toBe("trips");
    const styles = brief.styles as Array<{ style: string; fit: string; reason: string; pickable_by_ari: boolean; taken: boolean }>;
    expect(styles).toHaveLength(10);
    expect(styles.filter((entry) => !entry.pickable_by_ari).map((entry) => entry.style).sort()).toEqual(["nocturne", "pulse"]);
    expect(styles[0]).toMatchObject({ style: "voyage", fit: "pick", reason: "Big landscapes and a sociable voice for group trips." });
    expect(brief.skipped_line).toBe("Ari skipped Pulse and Nocturne: after-dark looks for daylight trips.");
    expect(writes).toEqual([]);
  });
});

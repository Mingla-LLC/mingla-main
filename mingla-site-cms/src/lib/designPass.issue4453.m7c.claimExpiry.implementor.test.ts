/*
 * #4453 milestone 7c rework (tester P3-2) — the design-pass claim expires.
 * A claim left by a crash, a failed release or an ambiguous write blocks the
 * draft for DESIGN_PASS_CLAIM_TTL_MS (10 minutes) at most; a live claim still
 * refuses a second pass (ALREADY_RUN); a finished pass stays "already run"
 * through the work log, whatever the claim's age. Harness mirrors
 * designPass.issue4453.m7c.tester.adversarial.test.ts with an expiring store.
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

import { DESIGN_PASS_CLAIM_TTL_MS, designPassClaimKey, runDesignPassAction } from "./designPass";
import { parseSignedDesignPass } from "./designPassInputs";
import type { AriActionContext } from "./ariSiteActions";

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
let nonces: Map<string, string>; // nonce -> expires_at
let claimFailure: Error | null = null;
let clock: number;
const tick = (): string => new Date(Date.UTC(2026, 10, 16, 12, 0, clock++)).toISOString();

function ctx(designPass: ReturnType<typeof signed> | null): AriActionContext {
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: { and?: Array<Record<string, { greater_than?: string }>> } }) => {
      if (collection === "publication-jobs") return { docs: publications.slice(-1) };
      if (collection === "gateway-nonces") {
        const nonce = (where as unknown as { nonce: { equals: string } }).nonce.equals;
        return { docs: nonces.has(nonce) ? [{ nonce, expires_at: nonces.get(nonce) }] : [] };
      }
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
        nonces.set(nonce, String((data as { expires_at: string }).expires_at));
        return { id: nonce };
      }
      writes.push({ op: "create", collection, data });
      return { id: `new-${writes.length}` };
    }),
    delete: vi.fn(async ({ collection, where }: { collection: string; where: { nonce: { equals: string }; expires_at?: { less_than?: string; equals?: string } } }) => {
      if (collection === "gateway-nonces") {
        const nonce = where.nonce.equals;
        const stored = String(nonces.get(nonce));
        // The real delete re-checks the expiry in its WHERE clause (older than now, or exactly the one written).
        const lessThan = where.expires_at?.less_than;
        const equals = where.expires_at?.equals;
        if ((lessThan === undefined || stored < lessThan) && (equals === undefined || stored === equals)) nonces.delete(nonce);
      }
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
  nonces = new Map();
  claimFailure = null;
  clock = 0;
});

const key = designPassClaimKey("t1", null);
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe("#4453 m7c rework — the design-pass claim expires", () => {
  it("a new claim expires after ten minutes", async () => {
    expect(DESIGN_PASS_CLAIM_TTL_MS).toBe(10 * 60 * 1000);
    const before = Date.now();
    await expect(pass("terra")).resolves.toMatchObject({ design: "terra" });
    const expires = Date.parse(String(nonces.get(key)));
    expect(expires - before).toBeGreaterThanOrEqual(DESIGN_PASS_CLAIM_TTL_MS - 1000);
    expect(expires - before).toBeLessThanOrEqual(DESIGN_PASS_CLAIM_TTL_MS + 5000);
  });

  it("an expired claim left behind (crash, failed release, ambiguous write) no longer blocks the draft", async () => {
    nonces.set(key, minutesFromNow(-1));
    await expect(pass("terra")).resolves.toMatchObject({ design: "terra" });
    expect(Date.parse(String(nonces.get(key)))).toBeGreaterThan(Date.now());
  });

  it("a live claim still refuses a second pass and is never deleted", async () => {
    const live = minutesFromNow(5);
    nonces.set(key, live);
    const c = ctx(signed());
    await expect(runDesignPassAction("propose_site_design_pass", { design_key: "terra", why: "Fits.", cites: [] }, c, deps)).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
    expect(nonces.get(key)).toBe(live);
    expect(writes).toEqual([]);
  });

  it("a finished pass stays already run after its claim expires (the work log, not the claim)", async () => {
    await expect(pass("terra")).resolves.toMatchObject({ design: "terra" });
    nonces.set(key, minutesFromNow(-1));
    await expect(pass("journal")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
  });

  it("an expired claim that cannot be cleared reads as try again, not already run", async () => {
    nonces.set(key, minutesFromNow(-1));
    const c = ctx(signed());
    (c.req.payload as unknown as { delete: ReturnType<typeof vi.fn> }).delete.mockRejectedValueOnce(new Error("Connection terminated"));
    await expect(runDesignPassAction("propose_site_design_pass", { design_key: "terra", why: "Fits.", cites: [] }, c, deps)).rejects.toThrow("DESIGN_PASS_TRY_AGAIN");
  });
});
